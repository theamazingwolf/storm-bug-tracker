import { constants as fsConstants, realpathSync } from "node:fs";
import { lstat, mkdir, open, link, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HOST_NAME } from "./src/constants.js";
import { isForkExtensionId } from "./src/security.js";

const packageDir = dirname(fileURLToPath(import.meta.url));
const BROWSERS = {
  chrome: join(homedir(), ".config", "google-chrome", "NativeMessagingHosts"),
  chromium: join(homedir(), ".config", "chromium", "NativeMessagingHosts"),
};
const uid = () => typeof process.getuid === "function" ? process.getuid() : null;

export function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }
export function buildLauncher({ extensionId, nodePath = process.execPath, hostPath = join(packageDir, "src", "host.js") }) {
  if (!isForkExtensionId(extensionId)) throw new Error("invalid_or_upstream_extension_id");
  const node = resolve(nodePath); const host = resolve(hostPath);
  return `#!/bin/sh\n# storm-bug-tracker-native-host-v1 ${extensionId}\n[ "$#" -eq 1 ] || exit 2\nexec ${shellQuote(node)} ${shellQuote(host)} ${shellQuote(`--allowed-extension-id=${extensionId}`)} "$1"\n`;
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || (uid() !== null && info.uid !== uid())) throw new Error("unsafe_install_directory");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0));
  try { const opened = await handle.stat(); if (!opened.isDirectory() || (uid() !== null && opened.uid !== uid())) throw new Error("unsafe_install_directory"); await handle.chmod(0o700); } finally { await handle.close(); }
}

async function readOwnedRegular(path, expectedMode) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || (uid() !== null && info.uid !== uid()) || (info.mode & 0o777) !== expectedMode) throw new Error("unsafe_install_file");
    return await handle.readFile("utf8");
  } catch (error) { if (error.code === "ENOENT") return null; if (error.code === "ELOOP") throw new Error("unsafe_install_file"); throw error; }
  finally { await handle?.close(); }
}

async function createOnce(path, content, mode) {
  const temp = join(dirname(path), `.storm-native-${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", mode);
  try { await handle.chmod(mode); await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  try {
    // link() is atomic and fails if target exists; unlike rename it cannot replace a symlink.
    await link(temp, path);
    await unlink(temp);
    const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
  } catch (error) { await unlink(temp).catch(() => {}); if (error.code === "EEXIST") throw new Error("install_target_conflict"); throw error; }
}

function manifestFor(extensionId, launcherPath) {
  return { name: HOST_NAME, description: "Storm Bug Tracker ChatGPT local helper", path: launcherPath, type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] };
}

export async function installManifest({ extensionId, browser = "chrome", configRoot = BROWSERS[browser], hostPath = join(packageDir, "src", "host.js"), nodePath = process.execPath }) {
  if (!isForkExtensionId(extensionId)) throw new Error("invalid_or_upstream_extension_id");
  if (!configRoot || !Object.hasOwn(BROWSERS, browser)) throw new Error("unsupported_browser");
  const root = resolve(configRoot);
  await privateDirectory(root);
  const launcherPath = join(root, `${HOST_NAME}-${extensionId}.sh`);
  const manifestPath = join(root, `${HOST_NAME}.json`);
  const launcherText = buildLauncher({ extensionId, hostPath, nodePath });
  const manifestText = `${JSON.stringify(manifestFor(extensionId, launcherPath), null, 2)}\n`;
  const existingManifest = await readOwnedRegular(manifestPath, 0o600);
  const existingLauncher = await readOwnedRegular(launcherPath, 0o700);
  if (existingManifest !== null && existingManifest !== manifestText) throw new Error("install_target_conflict");
  if (existingLauncher !== null && existingLauncher !== launcherText) throw new Error("install_target_conflict");
  if ((existingManifest === null) !== (existingLauncher === null)) throw new Error("incomplete_existing_install");
  if (existingManifest !== null) return manifestPath;
  await createOnce(launcherPath, launcherText, 0o700);
  try { await createOnce(manifestPath, manifestText, 0o600); }
  catch (error) {
    const owned = await readOwnedRegular(launcherPath, 0o700).catch(() => null);
    if (owned === launcherText) await unlink(launcherPath).catch(() => {});
    throw error;
  }
  return manifestPath;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--extension-id") out.extensionId = argv[++i];
    else if (argv[i] === "--browser") out.browser = argv[++i];
    else if (argv[i] === "--config-root") out.configRoot = argv[++i];
    else throw new Error("usage: node install.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <user-path>]");
  }
  if (!out.extensionId) throw new Error("usage: node install.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <user-path>]");
  return out;
}

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  try { process.stdout.write(`${await installManifest(args(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`install failed: ${error?.code === "browser_open_failed" ? error.code : error.message}\n`); process.exitCode = 1; }
}
