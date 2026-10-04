import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { HOST_NAME } from "./src/constants.js";
import { isForkExtensionId } from "./src/security.js";

const packageDir = dirname(fileURLToPath(import.meta.url));
const BROWSERS = {
  chrome: join(homedir(), ".config", "google-chrome", "NativeMessagingHosts"),
  chromium: join(homedir(), ".config", "chromium", "NativeMessagingHosts"),
};

export async function installManifest({ extensionId, browser = "chrome", configRoot = BROWSERS[browser], hostPath = join(packageDir, "src", "host.js"), nodePath = process.execPath }) {
  if (!isForkExtensionId(extensionId)) throw new Error("invalid_or_upstream_extension_id");
  if (!configRoot || !Object.hasOwn(BROWSERS, browser)) throw new Error("unsupported_browser");
  const root = resolve(configRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dirInfo = await lstat(root);
  if (dirInfo.isSymbolicLink() || !dirInfo.isDirectory()) throw new Error("unsafe_install_directory");
  const target = join(root, `${HOST_NAME}.json`);
  try { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw new Error("unsafe_manifest_path"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const content = `${JSON.stringify({ name: HOST_NAME, description: "Storm Bug Tracker ChatGPT local helper", path: resolve(nodePath), type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`], args: [resolve(hostPath), `--allowed-extension-id=${extensionId}`] }, null, 2)}\n`;
  await writeAtomic(target, content);
  return target;
}

async function writeAtomic(target, content) {
  const temp = join(dirname(target), `.native-host-${process.pid}-${Date.now()}.tmp`);
  const file = await open(temp, "wx", 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  try { await rename(temp, target); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--extension-id") out.extensionId = argv[++i];
    else if (argv[i] === "--browser") out.browser = argv[++i];
    else if (argv[i] === "--config-root") out.configRoot = argv[++i];
    else throw new Error("usage: node install.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <path>]");
  }
  if (!out.extensionId) throw new Error("usage: node install.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <path>]");
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${await installManifest(args(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`install failed: ${error.message}\n`); process.exitCode = 1; }
}
