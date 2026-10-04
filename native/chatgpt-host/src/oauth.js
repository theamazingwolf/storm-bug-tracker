import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { AUTH_TIMEOUT_MS, AUTH_ORIGIN, TOKEN_URL, ISSUER, JWKS_URL, CALLBACK_PATH, RESOURCE, PLAN_SCOPE } from "./constants.js";
import { createAuthAttempt, parseScopes, validateCallback } from "./security.js";

const REFRESH_RECENT_MS = 30_000;
const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new Error(reason instanceof Error && ["authorization_timeout", "request_cancelled", "token_timeout"].includes(reason.message) ? reason.message : "request_cancelled");
};
function deadlineSignal(parentSignal, timeoutMs, timeoutCode) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new Error("request_cancelled"));
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(timeoutCode)), timeoutMs);
  timer.unref?.();
  if (parentSignal?.aborted) onAbort();
  return { signal: controller.signal, dispose() { clearTimeout(timer); parentSignal?.removeEventListener("abort", onAbort); } };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { try { throwIfAborted(signal); } catch (error) { return Promise.reject(error); } }
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); try { throwIfAborted(signal); } catch (error) { reject(error); } };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}

export function openOfficialAuthUrl(url, spawnImpl = spawn) {
  const parsed = new URL(url);
  if (parsed.origin !== AUTH_ORIGIN || parsed.pathname !== "/api/accounts/authorize") throw new Error("invalid_authorize_url");
  return new Promise((resolve, reject) => {
    const child = spawnImpl("xdg-open", [url], { detached: true, stdio: "ignore", shell: false });
    let settled = false;
    child.once("error", () => { if (!settled) { settled = true; reject(new Error("browser_open_failed")); } });
    child.once("spawn", () => { if (!settled) { settled = true; child.unref(); resolve(); } });
  });
}

export function listenLoopback({ serverFactory = createServer, timeoutMs = AUTH_TIMEOUT_MS } = {}) {
  let server;
  let timer;
  let settled = false;
  let rejectWait;
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const promise = new Promise((resolve, reject) => {
    rejectWait = reject;
    server = serverFactory((req, res) => {
      const address = server.address();
      const expectedHost = `127.0.0.1:${address.port}`;
      if (req.headers.host !== expectedHost) { res.writeHead(400).end(); return; }
      let callback;
      try { callback = new URL(req.url, `http://${expectedHost}`); } catch { res.writeHead(400).end(); return; }
      if (req.method !== "GET" || callback.pathname !== CALLBACK_PATH) { res.writeHead(404).end(); return; }
      const rawUrl = `http://${expectedHost}${req.url}`;
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end("Authorization response received. You may close this window.");
      if (!settled) { settled = true; clearTimeout(timer); resolve(rawUrl); }
    });
    server.on("error", (error) => { readyReject(error); if (server.listening && !settled) { settled = true; clearTimeout(timer); reject(error); } });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const redirectUri = `http://127.0.0.1:${address.port}${CALLBACK_PATH}`;
      timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("authorization_timeout")); server.close(); } }, timeoutMs);
      timer.unref?.();
      readyResolve(redirectUri);
    });
  });
  return { ready, promise, cancel() { if (!settled) { settled = true; clearTimeout(timer); const error = new Error("authorization_cancelled"); readyReject(error); rejectWait(error); } server?.close(); } };
}

async function tokenPost(body, fetchImpl, signal, timeoutMs = 30_000) {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason ?? new Error("request_cancelled"));
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error("token_timeout")); }, timeoutMs);
  timer.unref?.();
  try {
    const response = await abortable(fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body), redirect: "error", signal: controller.signal }), controller.signal);
    throwIfAborted(signal);
    const data = await abortable(response.json().catch(() => ({})), controller.signal);
    throwIfAborted(signal);
    if (timedOut) throw new Error("token_timeout");
    if (!response.ok) {
      const err = new Error(data.error === "invalid_grant" ? "invalid_grant" : `token_http_${response.status}`);
      err.status = response.status;
      throw err;
    }
    return data;
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal);
    if (timedOut) throw new Error("token_timeout");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}

export async function verifyIdToken(idToken, { clientId, nonce, jwks = createRemoteJWKSet(new URL(JWKS_URL)), verify = jwtVerify } = {}) {
  const { payload } = await verify(idToken, jwks, { issuer: ISSUER, audience: clientId, algorithms: ["RS256"], requiredClaims: ["exp"], clockTolerance: 5 });
  if (typeof payload.sub !== "string" || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new Error("invalid_identity_token");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null, issuer: ISSUER };
}

function tokenRecord(data, identity, clientId, hostId, previous) {
  const scopes = parseScopes(data.scope);
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || typeof data.id_token !== "string" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || !scopes.has(PLAN_SCOPE)) throw new Error(scopes.has(PLAN_SCOPE) ? "invalid_token_response" : "plan_scope_not_granted");
  if (data.token_type && data.token_type.toLowerCase() !== "bearer") throw new Error("invalid_token_type");
  const now = Date.now();
  const earliest = typeof data.earliest_refresh_at === "number" ? data.earliest_refresh_at * (data.earliest_refresh_at < 1e12 ? 1000 : 1) : Date.parse(data.earliest_refresh_at ?? "");
  return { ...identity, clientId, hostId, accessToken: data.access_token, refreshToken: data.refresh_token, idToken: data.id_token, scopes: [...scopes], expiresAt: now + data.expires_in * 1000, earliestRefreshAt: Number.isFinite(earliest) ? earliest : (previous ? now + REFRESH_RECENT_MS : now), ...(previous ? { lastRefreshedAt: now } : {}), previousRefreshToken: previous };
}

export async function signIn({ store, profileId, clientId, hostId, newRegistration, listen = listenLoopback, openBrowser = openOfficialAuthUrl, fetchImpl = fetch, verify = verifyIdToken, signal }) {
  const flow = deadlineSignal(signal, AUTH_TIMEOUT_MS, "authorization_timeout");
  const flowSignal = flow.signal;
  let listener;
  const closeListener = () => listener?.cancel();
  try {
    throwIfAborted(flowSignal);
    let prior = null;
    if (profileId && !newRegistration) {
      prior = await store.get(profileId);
      throwIfAborted(flowSignal);
      if (!prior) throw new Error("profile_not_found");
      if (clientId && prior.clientId !== clientId) throw new Error("account_binding_mismatch");
      clientId = prior.clientId;
    } else if (profileId || !newRegistration) {
      throw new Error("profile_not_found");
    }
    const expectedVersion = prior?.credentialVersion ?? 0;
    listener = listen({ timeoutMs: AUTH_TIMEOUT_MS });
    listener.promise.catch(() => {});
    flowSignal.addEventListener("abort", closeListener, { once: true });
    throwIfAborted(flowSignal);
    const redirectUri = await abortable(listener.ready, flowSignal);
    throwIfAborted(flowSignal);
    const attempt = createAuthAttempt({ clientId, hostId, redirectUri, newRegistration });
    await abortable(openBrowser(attempt.authorizeUrl), flowSignal);
    throwIfAborted(flowSignal);
    const callbackUrl = await abortable(listener.promise, flowSignal);
    throwIfAborted(flowSignal);
    const callback = validateCallback(callbackUrl, attempt);
    const tokenData = await tokenPost({ grant_type: "authorization_code", client_id: callback.clientId, code: callback.code, code_verifier: attempt.verifier, redirect_uri: redirectUri, resource: RESOURCE }, fetchImpl, flowSignal);
    throwIfAborted(flowSignal);
    const identity = await abortable(verify(tokenData.id_token, { clientId: callback.clientId, nonce: attempt.nonce }), flowSignal);
    throwIfAborted(flowSignal);
    const boundId = createHash("sha256").update(`${identity.issuer}\0${identity.subject}\0${callback.clientId}`).digest("hex").slice(0, 40);
    if (profileId && boundId !== profileId) throw new Error("account_binding_mismatch");
    const record = tokenRecord(tokenData, identity, callback.clientId, hostId);
    const persist = async () => {
      throwIfAborted(flowSignal);
      const writeOptions = profileId
        ? { signal: flowSignal, expectedVersion, requireExisting: true, incrementVersion: true }
        : { signal: flowSignal, expectedVersion: 0, requireAbsent: true, incrementVersion: true };
      if (typeof store.putUnderLock === "function") return store.putUnderLock(boundId, record, writeOptions);
      throwIfAborted(flowSignal);
      return store.put(boundId, record, writeOptions);
    };
    if (typeof store.withProfileLock === "function") await store.withProfileLock(boundId, persist, { signal: flowSignal });
    else await persist();
    throwIfAborted(flowSignal);
    return { profileId: boundId, email: identity.email, subject: identity.subject, planEnabled: true };
  } finally {
    flowSignal.removeEventListener("abort", closeListener);
    listener?.cancel();
    flow.dispose();
  }
}

export function profileIdFor(identity, clientId) {
  return createHash("sha256").update(`${identity.issuer}\0${identity.subject}\0${clientId}`).digest("hex").slice(0, 40);
}

export async function refreshProfile({ store, profileId, fetchImpl = fetch, verify = verifyIdToken, now, force = false, signal, lockTimeoutMs }) {
  throwIfAborted(signal);
  const refreshInLock = async () => {
    const profile = await store.get(profileId);
    throwIfAborted(signal);
    if (!profile?.refreshToken) throw new Error("profile_not_signed_in");
    const currentTime = now ?? Date.now();
    if (profile.lastRefreshedAt && currentTime < profile.lastRefreshedAt + REFRESH_RECENT_MS && currentTime < profile.expiresAt) return { ...profile, profileId };
    if (currentTime < (profile.earliestRefreshAt ?? 0)) {
      if (currentTime >= profile.expiresAt - 60_000) throw new Error("token_refresh_not_yet_allowed");
      return { ...profile, profileId };
    }
    if (!force && currentTime < profile.expiresAt - 60_000) return { ...profile, profileId };
    const data = await tokenPost({ grant_type: "refresh_token", client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE }, fetchImpl, signal);
    throwIfAborted(signal);
    const scopes = parseScopes(data.scope ?? profile.scopes.join(" "));
    const identity = await abortable(verify(data.id_token, { clientId: profile.clientId }), signal);
    throwIfAborted(signal);
    if (identity.subject !== profile.subject || identity.issuer !== profile.issuer || !scopes.has(PLAN_SCOPE)) throw new Error("account_binding_mismatch");
    const next = { ...tokenRecord({ ...data, scope: [...scopes].join(" ") }, identity, profile.clientId, profile.hostId, profile.refreshToken), profileId, credentialVersion: profile.credentialVersion ?? 0 };
    throwIfAborted(signal);
    const writeOptions = { signal, expectedRefreshToken: profile.refreshToken, expectedVersion: profile.credentialVersion ?? 0, requireExisting: true };
    if (typeof store.putUnderLock === "function") await store.putUnderLock(profileId, next, writeOptions);
    else await store.put(profileId, next, writeOptions);
    return { ...next, previousRefreshToken: undefined };
  };
  if (typeof store.withProfileLock === "function") return store.withProfileLock(profileId, refreshInLock, { signal, timeoutMs: lockTimeoutMs });
  if (!refreshFlights.has(profileId)) {
    const flight = refreshInLock();
    refreshFlights.set(profileId, flight);
    flight.finally(() => refreshFlights.delete(profileId)).catch(() => {});
  }
  return abortable(refreshFlights.get(profileId), signal);
}
const refreshFlights = new Map();
