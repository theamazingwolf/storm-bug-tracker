import { mkdir, lstat, open, rename, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { isSafeProfileId } from "./security.js";

const MODE_DIR = 0o700;
const MODE_FILE = 0o600;

async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: MODE_DIR });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || (typeof process.getuid === "function" && info.uid !== process.getuid())) throw new Error("unsafe_storage_path");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
  try { const opened = await handle.stat(); if (!opened.isDirectory() || (typeof process.getuid === "function" && opened.uid !== process.getuid())) throw new Error("unsafe_storage_path"); await handle.chmod(MODE_DIR); } finally { await handle.close(); }
}

async function assertRegularNoSymlink(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() || (typeof process.getuid === "function" && info.uid !== process.getuid())) throw new Error("unsafe_profile_file");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

async function readPrivateText(path) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || (typeof process.getuid === "function" && info.uid !== process.getuid())) throw new Error("unsafe_profile_file");
    await handle.chmod(MODE_FILE);
    return await handle.readFile("utf8");
  } catch (error) {
    if (error.code === "ELOOP") throw new Error("unsafe_profile_file");
    throw error;
  } finally { await handle?.close(); }
}

export class ProfileStore {
  #locks = new Map();
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
  async put(profileId, record) {
    const path = this.#path(profileId);
    await ensurePrivateDir(this.directory);
    const oldLock = this.#locks.get(profileId) ?? Promise.resolve();
    const next = oldLock.then(async () => {
      const current = await this.get(profileId);
      if (current && record.previousRefreshToken && current.refreshToken !== record.previousRefreshToken) throw new Error("refresh_token_race");
      const clean = { ...record, profileId };
      delete clean.previousRefreshToken;
      await this.#atomicWrite(path, clean);
    });
    this.#locks.set(profileId, next.catch(() => {}));
    await next;
  }
  async removeTokens(profileId) {
    const record = await this.get(profileId);
    if (!record) return false;
    const { accessToken, refreshToken, idToken, ...identity } = record;
    await this.#atomicWrite(this.#path(profileId), { ...identity, signedOut: true });
    return true;
  }
  async #atomicWrite(path, value) {
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
      await assertRegularNoSymlink(path);
      await rename(temp, path);
      const dir = await open(this.directory, "r");
      try { await dir.sync(); } finally { await dir.close(); }
    } catch (error) { await unlink(temp).catch(() => {}); throw error; }
  }
}
