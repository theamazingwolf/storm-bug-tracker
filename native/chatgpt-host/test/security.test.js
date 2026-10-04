import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm, symlink, writeFile, readdir, access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAuthAttempt, createPkce, isExtensionId, FORBIDDEN_UPSTREAM_EXTENSION_ID, parseScopes, safeErrorCode, validateCallback } from "../src/security.js";
import { ProfileStore } from "../src/profiles.js";
import { FrameDecoder, encodeFrame } from "../src/frames.js";
import { validateRequest } from "../src/protocol.js";
import { validateNativeOrigin, createHostApplication } from "../src/host.js";
import { installManifest } from "../install.js";
import { uninstallManifest } from "../uninstall.js";
import { listenLoopback, openOfficialAuthUrl, refreshProfile, signIn, verifyIdToken } from "../src/oauth.js";
import { EventEmitter } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const tempDir = () => mkdtemp(join(tmpdir(), "storm-chatgpt-helper-"));

test("state, PKCE and nonce are fresh and S256 callback binds registration identity", () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(verifier, challenge);
  const args = { clientId: "issued-client-a", hostId: "urn:uuid:host", redirectUri: "http://127.0.0.1:12345/auth/callback", newRegistration: true };
  const one = createAuthAttempt(args); const two = createAuthAttempt(args);
  assert.notEqual(one.state, two.state); assert.notEqual(one.nonce, two.nonce); assert.notEqual(one.verifier, two.verifier);
  const url = new URL(one.authorizeUrl);
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("agent_name_hint"), "Storm Bug Tracker");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(one.verifier).digest("base64url"));
  const cb = new URL(args.redirectUri); cb.searchParams.set("state", one.state); cb.searchParams.set("code", "fake-auth-code"); cb.searchParams.set("client_id", "issued-client-a");
  assert.deepEqual(validateCallback(cb.toString(), one), { code: "fake-auth-code", clientId: "issued-client-a" });
  cb.searchParams.set("client_id", "dynamic_agent_client"); assert.throws(() => validateCallback(cb.toString(), one), /registration_incomplete/);
  cb.searchParams.set("client_id", "evil-client"); assert.equal(validateCallback(cb.toString(), one).clientId, "evil-client", "new registration binds to the issued callback ID, then verifies its ID-token audience");
  cb.searchParams.set("state", "wrong"); assert.throws(() => validateCallback(cb.toString(), one), /invalid_state/);
});

test("issued client ID is reused and mismatched returning client IDs rejected", () => {
  const attempt = createAuthAttempt({ clientId: "issued-client", hostId: "urn:uuid:host", redirectUri: "http://127.0.0.1:1111/auth/callback", newRegistration: false });
  const auth = new URL(attempt.authorizeUrl); assert.equal(auth.searchParams.get("client_id"), "issued-client"); assert.equal(auth.searchParams.has("agent_name_hint"), false);
  const cb = new URL(attempt.redirectUri); cb.searchParams.set("state", attempt.state); cb.searchParams.set("code", "fake-code");
  assert.equal(validateCallback(cb.toString(), attempt).clientId, "issued-client");
  cb.searchParams.set("client_id", "other-client"); assert.throws(() => validateCallback(cb.toString(), attempt), /account_binding_mismatch/);
});

test("scope gate and safe errors never echo credentials", () => {
  assert.equal(parseScopes("openid resource.invoke").has("chatgpt.tokens.use.direct"), false);
  assert.equal(safeErrorCode(new Error("Bearer fake-access-token")), "request_failed");
  assert.equal(safeErrorCode("refresh_token=fake-refresh-token"), "request_failed");
  assert.equal(safeErrorCode("invalid_profile_id"), "invalid_profile_id");
  assert.equal(safeErrorCode(new Error("authorization_cancelled")), "authorization_cancelled");
  assert.equal(safeErrorCode(new Error("authorization_denied")), "authorization_denied");
  assert.equal(safeErrorCode(new Error("authorization_timeout")), "authorization_timeout");
  assert.equal(safeErrorCode(new Error("invalid_state")), "invalid_state");
  assert.equal(safeErrorCode(Object.assign(new Error("provider detail"), { code: "fake_access_token_exposed" })), "request_failed");
  assert.equal(isExtensionId(EXT), true); assert.equal(isExtensionId("../" + EXT), false);
  assert.equal(FORBIDDEN_UPSTREAM_EXTENSION_ID, "dhmffogmoohdjficicjjfolcheklngfm");
});

test("profile storage is private, atomic, rotating refresh token race checked, and traversal-safe", async () => {
  const dir = await tempDir();
  try {
    const store = new ProfileStore(dir); const hostId = await store.initialize();
    assert.equal(hostId, await store.initialize());
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    const profile = { subject: "fake-subject", issuer: "https://auth.openai.com", clientId: "issued-client", hostId, scopes: ["chatgpt.tokens.use.direct"], accessToken: "fake-access-token", refreshToken: "fake-refresh-token", idToken: "fake-id-token", expiresAt: 1234, earliestRefreshAt: 0 };
    await store.put("profile_safe", profile);
    assert.equal((await stat(join(dir, "profile-profile_safe.json"))).mode & 0o777, 0o600);
    const rotated = { ...profile, accessToken: "fake-access-token-2", refreshToken: "fake-refresh-token-2", previousRefreshToken: "fake-refresh-token" };
    await store.put("profile_safe", rotated);
    assert.equal((await store.get("profile_safe")).refreshToken, "fake-refresh-token-2");
    await assert.rejects(store.put("profile_safe", { ...rotated, previousRefreshToken: "stale-fake-refresh-token" }), /refresh_token_race/);
    await assert.rejects(store.get("../outside"), /invalid_profile_id/);
    const staleId = "stale_lock"; const stalePath = join(dir, `.lock-${staleId}`);
    await mkdir(stalePath, { mode: 0o700 });
    await writeFile(join(stalePath, "owner.json"), JSON.stringify({ pid: 2_147_483_647, nonce: "dead-owner", startedAt: Date.now() }), { mode: 0o600 });
    assert.equal(await store.withProfileLock(staleId, async () => "recovered"), "recovered");
    await assert.rejects(stat(stalePath), { code: "ENOENT" });
    assert.equal(await store.removeTokens("profile_safe"), true);
    assert.equal((await store.get("profile_safe")).accessToken, undefined);
    const linkPath = join(dir, "profile-link.json"); await symlink(join(dir, "profile-profile_safe.json"), linkPath);
    await assert.rejects(store.get("link"), /unsafe_profile_file/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("native frames handle split input and reject malicious/oversized frames", () => {
  const frame = encodeFrame({ id: 4, method: "status", params: {} }); const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(frame.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(frame.subarray(3)), [{ id: 4, method: "status", params: {} }]);
  const oversized = Buffer.alloc(4); oversized.writeUInt32LE(256 * 1024 + 1);
  assert.throws(() => new FrameDecoder().push(oversized), /invalid_frame_size/);
  const badJson = Buffer.from([2, 0, 0, 0, 0x7b, 0x7d]); assert.deepEqual(new FrameDecoder().push(badJson), [{}]);
  assert.throws(() => validateRequest({ id: "x", method: "run", params: { command: "touch /tmp/pwn" } }), /unsupported_method/);
  assert.throws(() => validateRequest({ id: 1, method: "draft", params: { model: "m", text: "x", images: [{ mimeType: "image/png", data: "x" }] } }), /images_unsupported/);
  assert.equal(validateRequest({ id: 2, method: "draft", params: { model: "m", text: "x", instructions: "€".repeat(5_000) } }).params.instructions.length, 5_000);
  assert.equal(Buffer.byteLength(validateRequest({ id: 3, method: "draft", params: { model: "m", text: "x", instructions: "é".repeat(8_000) } }).params.instructions), 16_000);
  assert.throws(() => validateRequest({ id: 6, method: "draft", params: { model: "m", text: "x", instructions: "€".repeat(5_334) } }), /instructions_too_large/);
  assert.throws(() => validateRequest({ id: 4, method: "signIn", params: { profileId: 7 } }), /invalid_profile_id/);
  assert.throws(() => validateRequest({ id: 5, method: "signIn", params: { reconnect: true } }), /invalid_profile_id/);
});

test("native host requires exact caller extension origin and safe installer arguments", () => {
  assert.equal(validateNativeOrigin([`--allowed-extension-id=${EXT}`, `chrome-extension://${EXT}/`]), EXT);
  assert.throws(() => validateNativeOrigin([`--allowed-extension-id=${EXT}`, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]), /unauthorized_extension_origin/);
  assert.throws(() => validateNativeOrigin(["--allowed-extension-id=*", `chrome-extension://${EXT}/`]), /invalid_host_arguments|unauthorized_extension_origin/);
  assert.throws(() => validateNativeOrigin([`--allowed-extension-id=${FORBIDDEN_UPSTREAM_EXTENSION_ID}`, `chrome-extension://${FORBIDDEN_UPSTREAM_EXTENSION_ID}/`]), /unauthorized_extension_origin/);
});

test("installer/uninstaller only write matching manifests under temporary fixtures", async () => {
  const root = await tempDir();
  try {
    const path = await installManifest({ extensionId: EXT, browser: "chrome", configRoot: root, hostPath: "/opt/storm/src/host.js", nodePath: "/usr/bin/node" });
    const manifest = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), ["allowed_origins", "description", "name", "path", "type"].sort());
    assert.equal(manifest.name, "com.storm.bug_tracker.chatgpt");
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXT}/`]);
    assert.equal(manifest.path, join(root, `${manifest.name}-${EXT}.sh`));
    assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);
    const outsider = join(root, "unrelated.txt"); await writeFile(outsider, "keep me");
    const validText = await readFile(path, "utf8");
    await writeFile(path, JSON.stringify({ ...manifest, path: outsider, args: ["malicious"] }));
    await assert.rejects(uninstallManifest({ extensionId: EXT, browser: "chrome", configRoot: root }), /manifest_identity_mismatch/);
    assert.equal(await readFile(outsider, "utf8"), "keep me");
    await writeFile(path, validText);
    assert.throws(() => validateNativeOrigin([`--allowed-extension-id=${EXT}`, "chrome-extension://evil/"]), /unauthorized_extension_origin/);
    await assert.rejects(installManifest({ extensionId: "../../evil", browser: "chrome", configRoot: root }), /invalid_or_upstream_extension_id/);
    await assert.rejects(installManifest({ extensionId: FORBIDDEN_UPSTREAM_EXTENSION_ID, browser: "chrome", configRoot: root }), /invalid_or_upstream_extension_id/);
    await assert.rejects(uninstallManifest({ extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", browser: "chrome", configRoot: root }), /manifest_identity_mismatch/);
    assert.equal(await uninstallManifest({ extensionId: EXT, browser: "chrome", configRoot: root }), path);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function requestStatus(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, headers: { host } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });
}

test("loopback callback listener binds only 127.0.0.1 and enforces host and route", async () => {
  const listener = listenLoopback({ serverFactory: createServer, timeoutMs: 5000 });
  try {
    const redirect = await listener.ready; const url = new URL(redirect);
    assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.pathname, "/auth/callback");
    assert.equal(await requestStatus(Number(url.port), "/auth/callback?state=s&code=fake-code", "localhost:1"), 400);
    assert.equal(await requestStatus(Number(url.port), "/callback", `127.0.0.1:${url.port}`), 404);
    assert.equal(await requestStatus(Number(url.port), "/auth/callback?state=s&code=fake-code", `127.0.0.1:${url.port}`), 200);
    assert.match(await listener.promise, /127\.0\.0\.1/);
  } finally { listener.cancel(); }
});

test("refresh honors earliest_refresh_at and single-flights rotating token persistence", async () => {
  const old = { profileId: "profile_refresh", subject: "fake-subject", issuer: "https://auth.openai.com", clientId: "issued-client", hostId: "urn:uuid:host", scopes: ["chatgpt.tokens.use.direct", "offline_access"], accessToken: "fake-access-token", refreshToken: "fake-refresh-token", idToken: "fake-id-token", expiresAt: 900, earliestRefreshAt: 2_000 };
  let current = old; let exchanges = 0; let writes = 0;
  const store = { async get() { return current; }, async put(id, next) { assert.equal(id, old.profileId); writes++; assert.equal(next.previousRefreshToken, "fake-refresh-token"); current = { ...next, previousRefreshToken: undefined }; } };
  const fetchImpl = async (_url, init) => { exchanges++; const body = new URLSearchParams(init.body); assert.equal(body.get("refresh_token"), "fake-refresh-token"); return new Response(JSON.stringify({ access_token: "fake-access-token-rotated", refresh_token: "fake-refresh-token-rotated", id_token: "fake-id-token-rotated", token_type: "Bearer", expires_in: 3600, scope: "openid offline_access chatgpt.tokens.use.direct", earliest_refresh_at: "1970-01-01T00:00:04.000Z" }), { status: 200 }); };
  const verify = async () => ({ subject: "fake-subject", email: null, issuer: "https://auth.openai.com" });
  await assert.rejects(refreshProfile({ store, profileId: old.profileId, fetchImpl, verify, now: 1_999 }), /token_refresh_not_yet_allowed/);
  const [a, b] = await Promise.all([
    refreshProfile({ store, profileId: old.profileId, fetchImpl, verify, now: 2_000 }),
    refreshProfile({ store, profileId: old.profileId, fetchImpl, verify, now: 2_001 }),
  ]);
  assert.equal(exchanges, 1); assert.equal(writes, 1);
  assert.equal(a.profileId, old.profileId); assert.equal(b.profileId, old.profileId);
  assert.equal(a.refreshToken, "fake-refresh-token-rotated"); assert.equal(b.refreshToken, "fake-refresh-token-rotated");
  assert.equal(current.accessToken, "fake-access-token-rotated"); assert.equal(current.refreshToken, "fake-refresh-token-rotated"); assert.equal(current.idToken, "fake-id-token-rotated");
  assert.ok(current.expiresAt > 2_000);
});

test("cross-process profile locks serialize token rotation, isolate profiles, and preserve sign-out", async () => {
  const root = await tempDir();
  const profileModule = JSON.stringify(fileURLToPath(new URL("../src/profiles.js", import.meta.url)));
  const oauthModule = JSON.stringify(fileURLToPath(new URL("../src/oauth.js", import.meta.url)));
  const common = `
    import { ProfileStore } from ${profileModule};
    import { refreshProfile } from ${oauthModule};
    import { access, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const [dir, profileId, markerDir, mode, subject, gatePath] = process.argv.slice(1);
    const store = new ProfileStore(dir);
    const fetchImpl = async (_url, init) => {
      const body = new URLSearchParams(init.body);
      if (body.get('refresh_token') !== 'old-refresh-token') throw new Error('old token reused');
      const marker = join(markerDir, 'fetched-' + profileId + '-' + process.pid);
      await writeFile(marker, 'started', { flag: 'wx' });
      if (mode === 'barrier') {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) {
          const names = await import('node:fs/promises').then((m) => m.readdir(markerDir));
          if (names.some((name) => name.startsWith('fetched-' + process.env.OTHER_PROFILE + '-'))) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const names = await import('node:fs/promises').then((m) => m.readdir(markerDir));
        if (!names.some((name) => name.startsWith('fetched-' + process.env.OTHER_PROFILE + '-'))) throw new Error('profiles were not refreshed concurrently');
      }
      if (mode === 'hold') {
        const deadline = Date.now() + 4000;
        while (Date.now() < deadline) { try { await access(gatePath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } }
        try { await access(gatePath); } catch { throw new Error('refresh gate timed out'); }
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      return new Response(JSON.stringify({ access_token: 'new-access-token', refresh_token: 'new-refresh-token', id_token: 'new-id-token', token_type: 'Bearer', expires_in: 3600, scope: 'openid offline_access chatgpt.tokens.use.direct' }), { status: 200 });
    };
    const verify = async () => ({ subject, email: null, issuer: 'https://auth.openai.com' });
    const result = await refreshProfile({ store, profileId, fetchImpl, verify });
    process.stdout.write(result.profileId);
  `;
  const run = (code, args, env = {}) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 8_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code, signal) => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(`child exit=${code} signal=${signal}: ${stderr}`)); });
    });
    return { child, done };
  };
  const makeProfile = async (store, profileId, subject) => store.put(profileId, { subject, issuer: "https://auth.openai.com", clientId: "fake-client", hostId: "urn:uuid:host", scopes: ["openid", "offline_access", "chatgpt.tokens.use.direct"], accessToken: "old-access-token", refreshToken: "old-refresh-token", idToken: "old-id-token", expiresAt: Date.now() - 60_000, earliestRefreshAt: 0 });
  try {
    const store = new ProfileStore(join(root, "same")); const markers = join(root, "same-markers"); await store.initialize(); await import("node:fs/promises").then((fs) => fs.mkdir(markers));
    await makeProfile(store, "same_profile", "same-subject");
    const one = run(common, [store.directory, "same_profile", markers, "normal", "same-subject", "-"]);
    const two = run(common, [store.directory, "same_profile", markers, "normal", "same-subject", "-"]);
    assert.deepEqual(await Promise.all([one.done, two.done]), ["same_profile", "same_profile"]);
    assert.equal((await readdir(markers)).filter((name) => name.startsWith("fetched-same_profile-")).length, 1);
    const updated = await store.get("same_profile"); assert.equal(updated.refreshToken, "new-refresh-token");

    const parallelStore = new ProfileStore(join(root, "parallel")); const parallelMarkers = join(root, "parallel-markers"); await parallelStore.initialize(); await import("node:fs/promises").then((fs) => fs.mkdir(parallelMarkers));
    await makeProfile(parallelStore, "profile_a", "subject_a"); await makeProfile(parallelStore, "profile_b", "subject_b");
    const a = run(common, [parallelStore.directory, "profile_a", parallelMarkers, "barrier", "subject_a", "-"], { OTHER_PROFILE: "profile_b" });
    const b = run(common, [parallelStore.directory, "profile_b", parallelMarkers, "barrier", "subject_b", "-"], { OTHER_PROFILE: "profile_a" });
    assert.deepEqual(await Promise.all([a.done, b.done]), ["profile_a", "profile_b"]);

    const raceStore = new ProfileStore(join(root, "signout")); const raceMarkers = join(root, "signout-markers"); await raceStore.initialize(); await import("node:fs/promises").then((fs) => fs.mkdir(raceMarkers));
    await makeProfile(raceStore, "signout_profile", "signout_subject");
    const gate = join(root, "release-refresh");
    const refresh = run(common, [raceStore.directory, "signout_profile", raceMarkers, "hold", "signout_subject", gate]);
    const markerDeadline = Date.now() + 4_000;
    while (Date.now() < markerDeadline && !(await readdir(raceMarkers)).some((name) => name.startsWith("fetched-signout_profile-"))) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok((await readdir(raceMarkers)).some((name) => name.startsWith("fetched-signout_profile-")), "refresh reached token exchange");
    let signoutStarted;
    const signoutCode = `import { ProfileStore } from ${profileModule}; import { writeFile } from 'node:fs/promises'; const [dir, marker] = process.argv.slice(1); await writeFile(marker, 'started'); const store = new ProfileStore(dir); await store.removeTokens('signout_profile');`;
    const signout = run(signoutCode, [raceStore.directory, join(root, "signout-started")]);
    const signoutMarkerDeadline = Date.now() + 4_000;
    while (Date.now() < signoutMarkerDeadline) { try { await access(join(root, "signout-started")); signoutStarted = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); } }
    assert.equal(signoutStarted, true, "sign-out process started while refresh held the lock");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await writeFile(gate, "go");
    await Promise.all([refresh.done, signout.done]);
    const signedOut = await raceStore.get("signout_profile");
    assert.equal(signedOut.accessToken, undefined); assert.equal(signedOut.refreshToken, undefined); assert.equal(signedOut.signedOut, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sign-in refuses an identity-only grant and never persists a plan-enabled profile", async () => {
  let callbackResolve; let stored = false;
  const listener = { ready: Promise.resolve("http://127.0.0.1:33442/auth/callback"), promise: new Promise((resolve) => { callbackResolve = resolve; }), cancel() {} };
  await assert.rejects(signIn({
    store: { async put() { stored = true; } }, hostId: "urn:uuid:host", newRegistration: true,
    listen: () => listener,
    openBrowser(authUrl) { const auth = new URL(authUrl); const callback = new URL("http://127.0.0.1:33442/auth/callback"); callback.searchParams.set("state", auth.searchParams.get("state")); callback.searchParams.set("code", "fake-code"); callback.searchParams.set("client_id", "issued-client"); callbackResolve(callback.toString()); },
    async fetchImpl() { return new Response(JSON.stringify({ access_token: "fake-access-token", refresh_token: "fake-refresh-token", id_token: "fake-id-token", expires_in: 3600, scope: "openid profile email" }), { status: 200 }); },
    async verify() { return { subject: "fake-subject", email: null, issuer: "https://auth.openai.com" }; },
  }), /plan_scope_not_granted/);
  assert.equal(stored, false);
});

test("sign-in starts listener before browser launch and persists issued account only after validation", async () => {
  const order = []; let callbackResolve;
  const store = { async put(id, value) { order.push("store"); assert.equal(id.length, 40); assert.equal(value.clientId, "issued-client"); assert.equal(value.subject, "fake-subject"); } };
  const listener = {
    ready: Promise.resolve("http://127.0.0.1:33441/auth/callback"),
    promise: new Promise((resolve) => { callbackResolve = resolve; }),
    cancel() { order.push("closed"); },
  };
  const result = await signIn({
    store, hostId: "urn:uuid:host", newRegistration: true,
    listen() { order.push("listening"); return listener; },
    openBrowser(authUrl) {
      order.push("browser");
      const auth = new URL(authUrl);
      assert.equal(auth.searchParams.get("client_id"), "dynamic_agent_client");
      const callback = new URL("http://127.0.0.1:33441/auth/callback");
      callback.searchParams.set("state", auth.searchParams.get("state"));
      callback.searchParams.set("code", "fake-code"); callback.searchParams.set("client_id", "issued-client");
      callbackResolve(callback.toString()); order.push("callback");
    },
    async fetchImpl(url, init) {
      order.push("exchange"); assert.equal(url, "https://auth.openai.com/api/accounts/oauth/token");
      const body = new URLSearchParams(init.body); assert.equal(body.get("client_id"), "issued-client");
      assert.equal(body.get("redirect_uri"), "http://127.0.0.1:33441/auth/callback");
      return new Response(JSON.stringify({ access_token: "fake-access-token", refresh_token: "fake-refresh-token", id_token: "fake-id-token", token_type: "Bearer", expires_in: 3600, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct" }), { status: 200 });
    },
    async verify(_token, options) { order.push("verify"); assert.equal(options.clientId, "issued-client"); assert.ok(options.nonce); return { subject: "fake-subject", email: "fake@example.test", issuer: "https://auth.openai.com" }; },
  });
  assert.deepEqual(result, { profileId: result.profileId, email: "fake@example.test", subject: "fake-subject", planEnabled: true });
  assert.ok(order.indexOf("listening") < order.indexOf("browser"));
  assert.ok(order.indexOf("verify") < order.indexOf("store"));
  assert.equal(order.at(-1), "closed");
});

test("sign-in checks requested identity and cancellation before persistence or browser launch", async () => {
  let listenCalls = 0; let browserCalls = 0; let stored = false;
  await assert.rejects(signIn({ store: { async get() { return null; } }, profileId: "missing-profile", hostId: "urn:uuid:host", newRegistration: false, listen() { listenCalls++; }, openBrowser() { browserCalls++; } }), /profile_not_found/);
  assert.equal(listenCalls, 0); assert.equal(browserCalls, 0);
  const controller = new AbortController(); controller.abort(new Error("request_cancelled"));
  await assert.rejects(signIn({ store: { async put() { stored = true; } }, hostId: "urn:uuid:host", newRegistration: true, signal: controller.signal, listen() { listenCalls++; }, openBrowser() { browserCalls++; } }), /request_cancelled/);
  assert.equal(browserCalls, 0); assert.equal(stored, false);

  let callbackResolve; let verifyStartedResolve;
  const verifyStarted = new Promise((resolve) => { verifyStartedResolve = resolve; });
  const listener = { ready: Promise.resolve("http://127.0.0.1:33443/auth/callback"), promise: new Promise((resolve) => { callbackResolve = resolve; }), cancel() {} };
  let writes = 0;
  const liveController = new AbortController();
  const pending = signIn({
    store: { async put() { writes++; } }, hostId: "urn:uuid:host", newRegistration: true, signal: liveController.signal,
    listen: () => listener,
    openBrowser(authUrl) { const auth = new URL(authUrl); const callback = new URL("http://127.0.0.1:33443/auth/callback"); callback.searchParams.set("state", auth.searchParams.get("state")); callback.searchParams.set("code", "fake-code"); callback.searchParams.set("client_id", "issued-client"); callbackResolve(callback.toString()); },
    async fetchImpl() { return new Response(JSON.stringify({ access_token: "fake-access-token", refresh_token: "fake-refresh-token", id_token: "fake-id-token", expires_in: 3600, scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct" }), { status: 200 }); },
    async verify() { verifyStartedResolve(); return new Promise(() => {}); },
  });
  await verifyStarted; liveController.abort(new Error("request_cancelled"));
  await assert.rejects(pending, /request_cancelled/);
  assert.equal(writes, 0);

  let exchangeStartedResolve; let exchangeSignal;
  const exchangeStarted = new Promise((resolve) => { exchangeStartedResolve = resolve; });
  let callback2Resolve;
  const listener2 = { ready: Promise.resolve("http://127.0.0.1:33444/auth/callback"), promise: new Promise((resolve) => { callback2Resolve = resolve; }), cancel() {} };
  const exchangeController = new AbortController(); let exchangeWrites = 0;
  const exchangePending = signIn({
    store: { async put() { exchangeWrites++; } }, hostId: "urn:uuid:host", newRegistration: true, signal: exchangeController.signal,
    listen: () => listener2,
    openBrowser(authUrl) { const auth = new URL(authUrl); const callback = new URL("http://127.0.0.1:33444/auth/callback"); callback.searchParams.set("state", auth.searchParams.get("state")); callback.searchParams.set("code", "fake-code"); callback.searchParams.set("client_id", "issued-client"); callback2Resolve(callback.toString()); },
    fetchImpl(_url, init) { exchangeSignal = init.signal; exchangeStartedResolve(); return new Promise(() => {}); },
    async verify() { throw new Error("verify_should_not_run"); },
  });
  await exchangeStarted; exchangeController.abort(new Error("request_cancelled"));
  await assert.rejects(exchangePending, /request_cancelled/);
  assert.equal(exchangeSignal.aborted, true); assert.equal(exchangeWrites, 0);

  const child = new EventEmitter(); child.unref = () => {};
  const attempt = createAuthAttempt({ clientId: null, hostId: "urn:uuid:host", redirectUri: "http://127.0.0.1:1234/auth/callback", newRegistration: true });
  const browserFailure = openOfficialAuthUrl(attempt.authorizeUrl, () => child);
  queueMicrotask(() => child.emit("error", new Error("private operating-system detail")));
  await assert.rejects(browserFailure, /browser_open_failed/);
});

test("real JOSE verification rejects missing or expired ID-token expiry", async () => {
  // Ephemeral synthetic keys stay in memory; no provider or stored credentials are used.
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const makeToken = (expiresAt) => {
    const token = new SignJWT({ sub: "synthetic-user", nonce: "synthetic-nonce" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://auth.openai.com")
      .setAudience("synthetic-client");
    if (expiresAt !== undefined) token.setExpirationTime(expiresAt);
    return token.sign(privateKey);
  };
  const options = { clientId: "synthetic-client", nonce: "synthetic-nonce", jwks: publicKey };
  await assert.rejects(verifyIdToken(await makeToken(), options), (error) => error.claim === "exp");
  await assert.rejects(verifyIdToken(await makeToken(Math.floor(Date.now() / 1000) - 60), options), (error) => error.code === "ERR_JWT_EXPIRED");
  assert.equal((await verifyIdToken(await makeToken(Math.floor(Date.now() / 1000) + 60), options)).subject, "synthetic-user");
});

test("ID token validation delegates cryptography to jose and checks nonce and identity", async () => {
  const verify = async (_token, _jwks, options) => {
    assert.equal(options.issuer, "https://auth.openai.com"); assert.equal(options.audience, "issued-client"); assert.deepEqual(options.algorithms, ["RS256"]);
    return { payload: { sub: "fake-subject", email: "fake@example.test", nonce: "expected-nonce" } };
  };
  assert.deepEqual(await verifyIdToken("fake.id.token", { clientId: "issued-client", nonce: "expected-nonce", jwks: {}, verify }), { subject: "fake-subject", email: "fake@example.test", issuer: "https://auth.openai.com" });
  await assert.rejects(verifyIdToken("fake.id.token", { clientId: "issued-client", nonce: "wrong", jwks: {}, verify }), /invalid_identity_token/);
});
