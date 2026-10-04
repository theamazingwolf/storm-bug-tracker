import { constants as fsConstants, realpathSync } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { HOST_NAME } from "./src/constants.js";
import { isForkExtensionId } from "./src/security.js";

const ROOTS = { chrome: join(homedir(), ".config", "google-chrome", "NativeMessagingHosts"), chromium: join(homedir(), ".config", "chromium", "NativeMessagingHosts") };
const uid = () => typeof process.getuid === "function" ? process.getuid() : null;

async function readOwnedRegular(path, expectedMode) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || (uid() !== null && info.uid !== uid()) || (info.mode & 0o777) !== expectedMode) throw new Error("unsafe_manifest_path");
    return await handle.readFile("utf8");
  } catch (error) { if (error.code === "ENOENT") return null; if (error.code === "ELOOP") throw new Error("unsafe_manifest_path"); throw error; }
  finally { await handle?.close(); }
}

function expectedLauncherPath(root, extensionId) { return join(root, `${HOST_NAME}-${extensionId}.sh`); }
function readQuoted(line, start) {
  if (line[start] !== "'") return null;
  let value = "";
  for (let index = start + 1; index < line.length;) {
    if (line.startsWith("'\\''", index)) { value += "'"; index += 4; continue; }
    if (line[index] === "'") return { value, end: index + 1 };
    value += line[index++];
  }
  return null;
}
function matchesLauncher(text, extensionId) {
  const lines = text.split("\n");
  if (lines.length !== 5 || lines[0] !== "#!/bin/sh" || lines[1] !== `# storm-bug-tracker-native-host-v1 ${extensionId}` || lines[2] !== '[ "$#" -eq 1 ] || exit 2' || lines[4] !== "") return false;
  const line = lines[3];
  if (!line.startsWith("exec ")) return false;
  let cursor = 5;
  const values = [];
  for (let index = 0; index < 3; index++) {
    const token = readQuoted(line, cursor);
    if (!token) return false;
    values.push(token.value); cursor = token.end;
    if (index < 2) { if (line[cursor] !== " ") return false; cursor++; }
  }
  return isAbsolute(values[0]) && isAbsolute(values[1]) && basename(values[1]).endsWith(".js") && values[2] === `--allowed-extension-id=${extensionId}` && line.slice(cursor) === ' "$1"';
}

export async function uninstallManifest({ extensionId, browser = "chrome", configRoot = ROOTS[browser] }) {
  if (!isForkExtensionId(extensionId) || !Object.hasOwn(ROOTS, browser) || !configRoot) throw new Error("invalid_uninstall_options");
  const root = resolve(configRoot);
  const dirInfo = await lstat(root);
  if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory() || (uid() !== null && dirInfo.uid !== uid()) || (dirInfo.mode & 0o077) !== 0) throw new Error("unsafe_manifest_path");
  const manifestPath = join(root, `${HOST_NAME}.json`);
  const launcherPath = expectedLauncherPath(root, extensionId);
  const manifestText = await readOwnedRegular(manifestPath, 0o600);
  if (manifestText === null) throw new Error("manifest_not_found");
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch { throw new Error("manifest_identity_mismatch"); }
  const keys = Object.keys(manifest).sort();
  const expectedKeys = ["allowed_origins", "description", "name", "path", "type"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) || manifest.name !== HOST_NAME || manifest.description !== "Storm Bug Tracker ChatGPT local helper" || manifest.type !== "stdio" || manifest.path !== launcherPath || JSON.stringify(manifest.allowed_origins) !== JSON.stringify([`chrome-extension://${extensionId}/`])) throw new Error("manifest_identity_mismatch");
  const launcherText = await readOwnedRegular(launcherPath, 0o700);
  if (launcherText === null || !matchesLauncher(launcherText, extensionId)) throw new Error("launcher_identity_mismatch");
  // Never use manifest.path as a deletion target. Only the deterministic sibling launcher is eligible.
  await unlink(manifestPath);
  await unlink(launcherPath);
  return manifestPath;
}

function parse(argv) {
  const value = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--extension-id") value.extensionId = argv[++i];
    else if (argv[i] === "--browser") value.browser = argv[++i];
    else if (argv[i] === "--config-root") value.configRoot = argv[++i];
    else throw new Error("usage: node uninstall.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <user-path>]");
  }
  if (!value.extensionId) throw new Error("usage: node uninstall.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <user-path>]");
  return value;
}
const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  try { process.stdout.write(`${await uninstallManifest(parse(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`uninstall failed: ${error.message}\n`); process.exitCode = 1; }
}
