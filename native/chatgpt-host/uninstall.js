import { lstat, readFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { HOST_NAME } from "./src/constants.js";
import { isForkExtensionId } from "./src/security.js";

const ROOTS = { chrome: join(homedir(), ".config", "google-chrome", "NativeMessagingHosts"), chromium: join(homedir(), ".config", "chromium", "NativeMessagingHosts") };
export async function uninstallManifest({ extensionId, browser = "chrome", configRoot = ROOTS[browser] }) {
  if (!isForkExtensionId(extensionId) || !Object.hasOwn(ROOTS, browser) || !configRoot) throw new Error("invalid_uninstall_options");
  const root = resolve(configRoot); const target = join(root, `${HOST_NAME}.json`);
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("unsafe_manifest_path");
  const manifest = JSON.parse(await readFile(target, "utf8"));
  if (manifest.name !== HOST_NAME || JSON.stringify(manifest.allowed_origins) !== JSON.stringify([`chrome-extension://${extensionId}/`])) throw new Error("manifest_identity_mismatch");
  await unlink(target);
  return target;
}

function parse(argv) {
  const value = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--extension-id") value.extensionId = argv[++i];
    else if (argv[i] === "--browser") value.browser = argv[++i];
    else if (argv[i] === "--config-root") value.configRoot = argv[++i];
    else throw new Error("usage: node uninstall.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <path>]");
  }
  if (!value.extensionId) throw new Error("usage: node uninstall.js --extension-id <32-char-id> [--browser chrome|chromium] [--config-root <path>]");
  return value;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.stdout.write(`${await uninstallManifest(parse(process.argv.slice(2)))}\n`); }
  catch (error) { process.stderr.write(`uninstall failed: ${error.message}\n`); process.exitCode = 1; }
}
