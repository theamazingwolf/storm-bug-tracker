import { mkdir, lstat, open, rename, readdir, unlink, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { isSafeProfileId } from "./security.js";

const MODE_DIR = 0o700;
const MODE_FILE = 0o600;
const LOCK_TIMEOUT_MS = 15_000;
const LOCK_POLL_MS = 25;
const processUid = () => typeof process.getuid === "function" ? process.getuid() : null;
const aborted = (signal) => {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw new Error(reason instanceof Error && ["request_cancelled", "authorization_timeout", "timeout", "draft_timeout"].includes(reason.message) ? reason.message : "request_cancelled");
};

async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: MODE_DIR });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || (processUid() !== null && info.uid !== processUid())) throw new Error("unsafe_storage_path");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
  try { const opened = await handle.stat(); if (!opened.isDirectory() || (processUid() !== null && opened.uid !== processUid())) throw new Error("unsafe_storage_path"); await handle.chmod(MODE_DIR); } finally { await handle.close(); }
}

async function assertRegularNoSymlink(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || (processUid() !== null && info.uid !== processUid())) throw new Error("unsafe_profile_file");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function readPrivateText(path) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || (processUid() !== null && info.uid !== processUid())) throw new Error("unsafe_profile_file");
    await handle.chmod(MODE_FILE);
    return await handle.readFile("utf8");
  } catch (error) {
    if (error.code === "ELOOP") throw new Error("unsafe_profile_file");
    throw error;
  } finally { await handle?.close(); }
}

async function writeOwner(lockDir, owner) {
  const ownerPath = join(lockDir, "owner.json");
  const handle = await open(ownerPath, "wx", MODE_FILE);
  try { await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
}

async function readOwner(lockDir) {
  const dirInfo = await lstat(lockDir);
  if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory() || (processUid() !== null && dirInfo.uid !== processUid())) throw new Error("unsafe_lock_path");
  const owner = JSON.parse(await readPrivateText(join(lockDir, "owner.json")));
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.nonce !== "string") throw new Error("invalid_lock_owner");
  return owner;
}

function ownerIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

async function delay(ms, signal) {
  aborted(signal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", onAbort); resolve(); }
    function onAbort() { clearTimeout(timer); try { aborted(signal); } catch (error) { reject(error); } }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class ProfileStore {
  constructor(directory) { this.directory = directory; }
  async initialize() {
    await ensurePrivateDir(this.directory);
    const hostPath = join(this.directory, "host-id.json");
    await assertRegularNoSymlink(hostPath);
    try { const record = JSON.parse(await readPrivateText(hostPath)); if (typeof record.hostId === "string" && record.hostId.startsWith("urn:uuid:")) return record.hostId; } catch (e) { if (e.code !== "ENOENT") throw new Error("invalid_host_id_record"); }
    const hostId = `urn:uuid:${randomUUID()}`;
    try {
      const handle = await open(hostPath, "wx", MODE_FILE);
      try { await handle.writeFile(`${JSON.stringify({ hostId })}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      return hostId;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const record = JSON.parse(await readPrivateText(hostPath));
      if (typeof record.hostId !== "string" || !record.hostId.startsWith("urn:uuid:")) throw new Error("invalid_host_id_record");
      return record.hostId;
    }
  }
  #path(profileId) {
    if (!isSafeProfileId(profileId)) throw new Error("invalid_profile_id");
    return join(this.directory, `profile-${profileId}.json`);
  }
  #lockPath(profileId) { this.#path(profileId); return join(this.directory, `.lock-${profileId}`); }
  async list() {
    await ensurePrivateDir(this.directory);
    const entries = await readdir(this.directory);
    const profiles = [];
    for (const name of entries.filter((n) => /^profile-[A-Za-z0-9_-]{1,80}\.json$/.test(n))) {
      const id = name.slice(8, -5);
      const record = await this.get(id);
      if (record) profiles.push({ id, email: record.email ?? null, subject: record.subject, clientId: record.clientId, signedIn: Boolean(record.accessToken && record.refreshToken), planEnabled: record.scopes.includes("chatgpt.tokens.use.direct") });
    }
    return profiles;
  }
  async get(profileId) {
    const path = this.#path(profileId);
    await assertRegularNoSymlink(path);
    try {
      const record = JSON.parse(await readPrivateText(path));
      if (!record || record.profileId !== profileId || typeof record.clientId !== "string" || typeof record.subject !== "string" || !Array.isArray(record.scopes)) throw new Error("invalid_profile_record");
      return record;
    } catch (error) { if (error.code === "ENOENT") return null; if (error instanceof SyntaxError) throw new Error("invalid_profile_record"); throw error; }
  }
  async withProfileLock(profileId, operation, { signal, timeoutMs = LOCK_TIMEOUT_MS } = {}) {
    const lockPath = this.#lockPath(profileId);
    const recoveryPath = join(this.directory, ".lock-recovery");
    await ensurePrivateDir(this.directory);
    const deadline = Date.now() + timeoutMs;
    const nonce = randomUUID();
    while (true) {
      aborted(signal);
      try {
        await mkdir(lockPath, { mode: MODE_DIR });
        try { await writeOwner(lockPath, { pid: process.pid, nonce, startedAt: Date.now() }); }
        catch (error) { await unlink(join(lockPath, "owner.json")).catch(() => {}); await rmdir(lockPath).catch(() => {}); throw error; }
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        await this.#recoverDeadOwner(lockPath, recoveryPath);
        if (Date.now() >= deadline) throw new Error("profile_lock_busy");
        await delay(Math.min(LOCK_POLL_MS, Math.max(1, deadline - Date.now())), signal);
      }
    }
    try { aborted(signal); return await operation(); }
    finally {
      try {
        const owner = await readOwner(lockPath);
        if (owner.pid === process.pid && owner.nonce === nonce) {
          await unlink(join(lockPath, "owner.json"));
          await rmdir(lockPath);
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  async #recoverDeadOwner(lockPath, recoveryPath) {
    let recoveryOwned = false;
    const recoveryNonce = randomUUID();
    try {
      await mkdir(recoveryPath, { mode: MODE_DIR });
      await writeOwner(recoveryPath, { pid: process.pid, nonce: recoveryNonce, startedAt: Date.now() });
      recoveryOwned = true;
    } catch (error) { if (error.code !== "EEXIST") throw error; return; }
    try {
      let owner;
      try { owner = await readOwner(lockPath); }
      catch (error) {
        // An owner file can be between mkdir and write. It is not safe to steal; let bounded wait report busy.
        if (error.code === "ENOENT") return;
        throw error;
      }
      if (ownerIsAlive(owner.pid)) return;
      const stalePath = join(this.directory, `.stale-lock-${owner.nonce}-${randomUUID()}`);
      try {
        await rename(lockPath, stalePath);
        const moved = await readOwner(stalePath);
        if (moved.pid === owner.pid && moved.nonce === owner.nonce && !ownerIsAlive(moved.pid)) {
          await unlink(join(stalePath, "owner.json"));
          await rmdir(stalePath);
        } else {
          // This should only occur after external tampering. Preserve the directory for manual recovery.
          throw new Error("profile_lock_owner_changed");
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    } finally {
      if (recoveryOwned) {
        try {
          const owner = await readOwner(recoveryPath);
          if (owner.pid === process.pid && owner.nonce === recoveryNonce) { await unlink(join(recoveryPath, "owner.json")); await rmdir(recoveryPath); }
        } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    }
  }
  async put(profileId, record, options = {}) {
    return this.withProfileLock(profileId, () => this.putUnderLock(profileId, record, options), { signal: options.signal, timeoutMs: options.timeoutMs });
  }
  // Caller must already hold withProfileLock(profileId). Used by refresh/sign-in to keep the lock across network exchange.
  async putUnderLock(profileId, record, { signal, expectedRefreshToken, expectedVersion, requireExisting = false, requireAbsent = false, incrementVersion = false } = {}) {
    aborted(signal);
    const path = this.#path(profileId);
    const current = await this.get(profileId);
    if (requireExisting && !current) throw new Error("profile_not_found");
    if (requireAbsent && current) throw new Error("profile_already_exists");
    if (expectedVersion !== undefined && (current?.credentialVersion ?? 0) !== expectedVersion) throw new Error("auth_superseded");
    const oldRefreshToken = expectedRefreshToken ?? record.previousRefreshToken;
    if (current && oldRefreshToken && current.refreshToken !== oldRefreshToken) throw new Error("refresh_token_race");
    if (!current && oldRefreshToken) throw new Error("refresh_token_race");
    const clean = { ...record, profileId, credentialVersion: incrementVersion ? (current?.credentialVersion ?? 0) + 1 : (record.credentialVersion ?? current?.credentialVersion ?? 0) };
    delete clean.previousRefreshToken;
    await this.#atomicWrite(path, clean, { signal });
  }
  async removeTokens(profileId, options = {}) {
    const path = this.#path(profileId);
    return this.withProfileLock(profileId, async () => {
      const record = await this.get(profileId);
      if (!record) return false;
      const { accessToken, refreshToken, idToken, ...identity } = record;
      await this.#atomicWrite(path, { ...identity, credentialVersion: (record.credentialVersion ?? 0) + 1, signedOut: true }, { signal: options.signal });
      return true;
    }, { signal: options.signal, timeoutMs: options.timeoutMs });
  }
  async #atomicWrite(path, value, { signal } = {}) {
    aborted(signal);
    await ensurePrivateDir(this.directory);
    await assertRegularNoSymlink(path);
    const temp = join(dirname(path), `.tmp-${randomUUID()}`);
    const handle = await open(temp, "wx", MODE_FILE);
    try {
      await handle.chmod(MODE_FILE);
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    try {
      aborted(signal);
      await assertRegularNoSymlink(path);
      await rename(temp, path);
      const dir = await open(this.directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
    } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  }
}
