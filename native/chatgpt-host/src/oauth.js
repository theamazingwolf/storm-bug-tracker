import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { AUTH_TIMEOUT_MS, AUTH_ORIGIN, TOKEN_URL, ISSUER, JWKS_URL, CALLBACK_PATH, RESOURCE, PLAN_SCOPE } from "./constants.js";
import { createAuthAttempt, parseScopes, validateCallback } from "./security.js";

export function openOfficialAuthUrl(url, spawnImpl = spawn) {
  const parsed = new URL(url);
  if (parsed.origin !== AUTH_ORIGIN || parsed.pathname !== "/api/accounts/authorize") throw new Error("invalid_authorize_url");
  const child = spawnImpl("xdg-open", [url], { detached: true, stdio: "ignore", shell: false });
  child.unref();
  return child;
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

async function tokenPost(body, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(body), redirect: "error", signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error === "invalid_grant" ? "invalid_grant" : `token_http_${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

export async function verifyIdToken(idToken, { clientId, nonce, jwks = createRemoteJWKSet(new URL(JWKS_URL)), verify = jwtVerify } = {}) {
  const { payload } = await verify(idToken, jwks, { issuer: ISSUER, audience: clientId, algorithms: ["RS256"], clockTolerance: 5 });
  if (typeof payload.sub !== "string" || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw new Error("invalid_identity_token");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : null, issuer: ISSUER };
}

function tokenRecord(data, identity, clientId, hostId, previous) {
  const scopes = parseScopes(data.scope);
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || typeof data.id_token !== "string" || !Number.isFinite(data.expires_in) || !scopes.has(PLAN_SCOPE)) throw new Error(scopes.has(PLAN_SCOPE) ? "invalid_token_response" : "plan_scope_not_granted");
  if (data.token_type && data.token_type.toLowerCase() !== "bearer") throw new Error("invalid_token_type");
  const now = Date.now();
  const earliest = typeof data.earliest_refresh_at === "number" ? data.earliest_refresh_at * (data.earliest_refresh_at < 1e12 ? 1000 : 1) : Date.parse(data.earliest_refresh_at ?? "");
  return { ...identity, clientId, hostId, accessToken: data.access_token, refreshToken: data.refresh_token, idToken: data.id_token, scopes: [...scopes], expiresAt: now + data.expires_in * 1000, earliestRefreshAt: Number.isFinite(earliest) ? earliest : now, previousRefreshToken: previous };
}

export async function signIn({ store, profileId, clientId, hostId, newRegistration, listen = listenLoopback, openBrowser = openOfficialAuthUrl, fetchImpl = fetch, verify = verifyIdToken, signal }) {
  const listener = listen();
  listener.promise.catch(() => {});
  let cancelled = false;
  const abort = () => { cancelled = true; listener.cancel(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const redirectUri = await listener.ready;
    const attempt = createAuthAttempt({ clientId, hostId, redirectUri, newRegistration });
    openBrowser(attempt.authorizeUrl);
    const callbackUrl = await listener.promise;
    if (cancelled) throw new Error("authorization_cancelled");
    const callback = validateCallback(callbackUrl, attempt);
    const tokenData = await tokenPost({ grant_type: "authorization_code", client_id: callback.clientId, code: callback.code, code_verifier: attempt.verifier, redirect_uri: redirectUri, resource: RESOURCE }, fetchImpl);
    const identity = await verify(tokenData.id_token, { clientId: callback.clientId, nonce: attempt.nonce });
    const boundId = createHash("sha256").update(`${identity.issuer}\0${identity.subject}\0${callback.clientId}`).digest("hex").slice(0, 40);
    if (profileId && boundId !== profileId) throw new Error("account_binding_mismatch");
    const record = tokenRecord(tokenData, identity, callback.clientId, hostId);
    await store.put(boundId, record);
    return { profileId: boundId, email: identity.email, subject: identity.subject, planEnabled: true };
  } finally { signal?.removeEventListener("abort", abort); listener.cancel(); }
}

export function profileIdFor(identity, clientId) {
  return createHash("sha256").update(`${identity.issuer}\0${identity.subject}\0${clientId}`).digest("hex").slice(0, 40);
}

export async function refreshProfile({ store, profileId, fetchImpl = fetch, verify = verifyIdToken, now = Date.now(), force = false }) {
  if (!refreshFlights.has(profileId)) {
    const promise = (async () => {
      const profile = await store.get(profileId);
      if (!profile?.refreshToken) throw new Error("profile_not_signed_in");
      if (!force && now < (profile.earliestRefreshAt ?? 0)) {
        if (now >= profile.expiresAt - 60_000) throw new Error("token_refresh_not_yet_allowed");
        return profile;
      }
      if (!force && now < profile.expiresAt - 60_000) return profile;
      const data = await tokenPost({ grant_type: "refresh_token", client_id: profile.clientId, refresh_token: profile.refreshToken, resource: RESOURCE }, fetchImpl);
      const scopes = parseScopes(data.scope ?? profile.scopes.join(" "));
      // Refresh responses are still signed ID tokens; nonce is only bound to authorization requests.
      const identity = await verify(data.id_token, { clientId: profile.clientId });
      if (identity.subject !== profile.subject || !scopes.has(PLAN_SCOPE)) throw new Error("account_binding_mismatch");
      const next = tokenRecord({ ...data, scope: [...scopes].join(" ") }, identity, profile.clientId, profile.hostId, profile.refreshToken);
      await store.put(profileId, next);
      return { ...next, previousRefreshToken: undefined };
    })();
    refreshFlights.set(profileId, promise);
    promise.finally(() => refreshFlights.delete(profileId)).catch(() => {});
  }
  return refreshFlights.get(profileId);
}
const refreshFlights = new Map();
