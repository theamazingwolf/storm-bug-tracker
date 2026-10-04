import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { FrameDecoder, encodeFrame } from "../src/frames.js";
import { installManifest } from "../install.js";
import { uninstallManifest } from "../uninstall.js";
import { FORBIDDEN_UPSTREAM_EXTENSION_ID } from "../src/security.js";

const EXT = "abcdefghijklmnopabcdefghijklmnop";
const hostSource = fileURLToPath(new URL("../src/host.js", import.meta.url));

function invokeLauncher(launcherPath, origin, request, dataDir) {
  return new Promise((resolve) => {
    const child = spawn(launcherPath, [origin], { cwd: "/", env: { ...process.env, STORM_BUG_TRACKER_CHATGPT_HOME: dataDir }, stdio: ["pipe", "pipe", "pipe"] });
    const decoder = new FrameDecoder();
    let response = null; let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      try {
        const frames = decoder.push(chunk);
        if (frames.length) { response = frames[0]; child.stdin.end(); }
      } catch (error) { stderr += `decode:${error.message}`; child.kill(); }
    });
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, response, stderr: `${stderr}${error.message}` }); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, response, stderr }); });
    if (request) child.stdin.write(encodeFrame(request));
  });
}

test("generated launcher is Chrome-shaped, safely quoted, and rejects other origins before data access", async () => {
  const root = await mkdtemp(join(tmpdir(), "storm-helper-launcher-"));
  try {
    const configRoot = join(root, "Native Hosts with spaces ' apostrophe $ and λ");
    const nodePath = join(root, "node executable ' $ λ");
    const hostPath = join(root, "host entry ' $ λ.js");
    const dataDir = join(root, "private data");
    await symlink(process.execPath, nodePath);
    await symlink(hostSource, hostPath);
    const manifestPath = await installManifest({ extensionId: EXT, browser: "chrome", configRoot, nodePath, hostPath });
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.args, undefined);
    assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);

    const valid = await invokeLauncher(manifest.path, `chrome-extension://${EXT}/`, { id: "status", method: "status", params: {} }, dataDir);
    assert.equal(valid.code, 0, valid.stderr);
    assert.deepEqual(valid.response?.result?.imageInput, "unsupported");
    assert.equal(valid.response?.result?.connected, false);

    const deniedData = join(root, "must-not-be-created");
    const wrongOrigin = await invokeLauncher(manifest.path, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/", null, deniedData);
    assert.equal(wrongOrigin.code, 2);
    assert.match(wrongOrigin.stderr, /unauthorized_extension_origin/);
    await assert.rejects(stat(deniedData), { code: "ENOENT" });

    const forbiddenData = join(root, "upstream-must-not-be-created");
    const upstream = await invokeLauncher(manifest.path, `chrome-extension://${FORBIDDEN_UPSTREAM_EXTENSION_ID}/`, null, forbiddenData);
    assert.equal(upstream.code, 2);
    assert.match(upstream.stderr, /unauthorized_extension_origin/);
    await assert.rejects(stat(forbiddenData), { code: "ENOENT" });
    await uninstallManifest({ extensionId: EXT, browser: "chrome", configRoot });
  } finally { await rm(root, { recursive: true, force: true }); }
});
