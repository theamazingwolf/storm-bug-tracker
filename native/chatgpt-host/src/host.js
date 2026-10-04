import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FrameDecoder, encodeFrame } from "./frames.js";
import { errorMessage, eventMessage, resultMessage, validateRequest } from "./protocol.js";
import { safeErrorCode, isForkExtensionId } from "./security.js";
import { ProfileStore } from "./profiles.js";
import { signIn } from "./oauth.js";
import { listModels, draft } from "./responses.js";
import { PLAN_SCOPE, MAX_INFLIGHT_REQUESTS, MAX_FRAME_BYTES } from "./constants.js";

const safeMessage = (code) => ({
  authorization_denied: "Sign-in was cancelled.", authorization_cancelled: "Sign-in was cancelled.", authorization_timeout: "Sign-in timed out. Try again.",
  browser_open_failed: "Could not open the system browser. Check that xdg-open is available.",
  invalid_state: "The sign-in response could not be verified. Start sign-in again.",
  plan_scope_not_granted: "ChatGPT plan access was not granted. Sign in again and approve plan usage.",
  subscription_sharing_usage_limit_exceeded: "ChatGPT plan usage is limited. Review usage in ChatGPT settings before trying again.",
  model_not_available: "That model is not available for the selected account. Refresh the model list.",
  images_unsupported: "Image input is not supported in this helper yet. Choose text-only drafting.",
  request_cancelled: "The request was cancelled.", cancelled: "The request was cancelled.",
  profile_lock_busy: "Another helper process is updating this profile. Retry shortly. If it stays busy, inspect the private lock owner in the helper data directory before removing a stale lock.",
  host_busy: "The helper is busy. Wait for an active request to finish, then retry.",
  token_refresh_not_yet_allowed: "The account token cannot be refreshed yet. Retry when the helper reports the token is eligible.",
  request_too_large: "The request is too large. Shorten the draft context and try again.", instructions_too_large: "Application instructions exceed 16,000 UTF-8 bytes.",
}[code] ?? "The request could not be completed. Check the helper status and try again.");

const LONG_METHODS = new Set(["signIn", "listModels", "draft"]);

export function validateNativeOrigin(args) {
  if (!Array.isArray(args) || args.length !== 2 || !args[0].startsWith("--allowed-extension-id=")) throw new Error("invalid_host_arguments");
  const configured = args[0].slice("--allowed-extension-id=".length);
  const caller = args[1];
  if (!isForkExtensionId(configured) || caller !== `chrome-extension://${configured}/`) throw new Error("unauthorized_extension_origin");
  return configured;
}

export function createHostApplication({ store, signInImpl = signIn, modelsImpl = listModels, draftImpl = draft, fetchImpl = fetch, openBrowser, emit = () => {}, maxInflightRequests = MAX_INFLIGHT_REQUESTS }) {
  let activeProfileId = null;
  const requests = new Map();
  async function getProfile(profileId) {
    const id = profileId;
    if (!id) throw new Error("profile_not_selected");
    const profile = await store.get(id);
    if (!profile?.accessToken || !profile.refreshToken) throw new Error("profile_not_signed_in");
    if (!profile.scopes.includes(PLAN_SCOPE)) throw new Error("plan_scope_not_granted");
    return profile;
  }
  const handle = async function handle(raw) {
    let request;
    try { request = validateRequest(raw); }
    catch (error) { return errorMessage(raw?.id ?? null, safeErrorCode(error), safeMessage(safeErrorCode(error))); }
    const { id, method, params } = request;
    const key = String(id);
    if (requests.has(key)) return errorMessage(id, "duplicate_request_id", safeMessage("duplicate_request_id"));
    const longCount = [...requests.values()].filter((entry) => entry.long).length;
    if (method !== "cancel" && longCount >= maxInflightRequests) return errorMessage(id, "host_busy", safeMessage("host_busy"));
    const profileIdAtArrival = params.profileId ?? activeProfileId;
    const controller = method === "cancel" ? null : new AbortController();
    const entry = { controller, profileId: method === "signIn" ? (params.profileId ?? null) : profileIdAtArrival, long: LONG_METHODS.has(method), method };
    requests.set(key, entry);
    const checkCancelled = () => { if (controller?.signal.aborted) throw new Error("request_cancelled"); };
    try {
      let result;
      switch (method) {
        case "status": {
          const profiles = await store.list();
          const selected = activeProfileId ? profiles.find((p) => p.id === activeProfileId) : null;
          result = { connected: selected?.signedIn ?? false, activeProfileId, profile: selected ?? null, planEnabled: selected?.signedIn === true && selected.planEnabled, imageInput: "unsupported" };
          break;
        }
        case "signIn": {
          const hostId = await store.initialize();
          checkCancelled();
          const existing = params.profileId ? await store.get(params.profileId) : null;
          checkCancelled();
          if (params.profileId && !existing) throw new Error("profile_not_found");
          const signed = await signInImpl({ store, profileId: existing?.profileId, clientId: existing?.clientId, hostId, newRegistration: !params.profileId, fetchImpl, openBrowser, signal: controller.signal });
          checkCancelled();
          activeProfileId = signed.profileId;
          result = { profileId: signed.profileId, email: signed.email, planEnabled: signed.planEnabled, active: true };
          break;
        }
        case "listProfiles": result = { profiles: await store.list() }; break;
        case "selectProfile": {
          const profile = await store.get(params.profileId);
          if (!profile) throw new Error("profile_not_found");
          activeProfileId = params.profileId;
          result = { profileId: activeProfileId, selected: true };
          break;
        }
        case "listModels": {
          const profile = await getProfile(profileIdAtArrival);
          checkCancelled();
          const models = await modelsImpl({ profile, store, fetchImpl, signal: controller.signal });
          checkCancelled();
          result = { profileId: profile.profileId, models };
          break;
        }
        case "draft": {
          const profile = await getProfile(profileIdAtArrival);
          checkCancelled();
          const value = await draftImpl({ profile, model: params.model, text: params.text, instructions: params.instructions, store, fetchImpl, signal: controller.signal, onDelta: (delta) => emit(eventMessage("draftDelta", { requestId: id, delta })) });
          checkCancelled();
          if (value.completed !== true || typeof value.text !== "string" || value.text.trim().length === 0) throw new Error("empty_draft_result");
          result = { profileId: profile.profileId, text: value.text, completed: true };
          break;
        }
        case "cancel": {
          const pending = requests.get(String(params.requestId));
          if (pending?.controller) pending.controller.abort();
          result = { requestId: params.requestId, cancelled: Boolean(pending?.controller) };
          break;
        }
        case "signOut": {
          for (const [pendingKey, pending] of requests) if (pendingKey !== key && pending.profileId === params.profileId) pending.controller?.abort();
          const removed = await store.removeTokens(params.profileId, { signal: controller.signal, timeoutMs: 8_000 });
          checkCancelled();
          if (!removed) throw new Error("profile_not_found");
          if (activeProfileId === params.profileId) activeProfileId = null;
          result = { profileId: params.profileId, localCredentialsCleared: true, remoteRevocation: "not_attempted", detail: "Local sign-out does not confirm remote permission revocation. Disconnect this app in ChatGPT settings to revoke it remotely." };
          break;
        }
      }
      return resultMessage(id, result);
    } catch (error) {
      const code = safeErrorCode(error);
      return errorMessage(id, code, safeMessage(code));
    } finally { requests.delete(key); }
  };
  handle.abortAll = () => { for (const entry of requests.values()) entry.controller?.abort(); };
  return handle;
}

export function runNativeHost({ input = process.stdin, output = process.stdout, stderr = process.stderr, args = process.argv.slice(2), env = process.env, store, signInImpl, modelsImpl, draftImpl, fetchImpl = fetch, openBrowser, maxInflightRequests = MAX_INFLIGHT_REQUESTS } = {}) {
  try { validateNativeOrigin(args); }
  catch (error) { stderr.write(`native-host: ${safeErrorCode(error)}\n`); return 2; }
  const dataDir = env.STORM_BUG_TRACKER_CHATGPT_HOME ?? `${homedir()}/.config/storm-bug-tracker/chatgpt`;
  const profileStore = store ?? new ProfileStore(dataDir);
  let closing = false;
  const tasks = new Set();
  const maxTasks = MAX_INFLIGHT_REQUESTS * 2;
  const writeMessage = (message) => {
    if (closing || output.destroyed || output.writableEnded) return false;
    try {
      output.write(encodeFrame(message, { maxBytes: MAX_FRAME_BYTES }));
      return true;
    } catch (error) {
      const code = safeErrorCode(error);
      if (message?.id !== undefined && code === "response_too_large") {
        try { output.write(encodeFrame(errorMessage(message.id, code, safeMessage(code)), { maxBytes: MAX_FRAME_BYTES })); return true; } catch { /* Closing below is the only safe recovery. */ }
      }
      stderr.write(`native-host: ${code}\n`);
      shutdown();
      return false;
    }
  };
  const handle = createHostApplication({ store: profileStore, signInImpl, modelsImpl, draftImpl, fetchImpl, openBrowser, emit: writeMessage, maxInflightRequests });
  const decoder = new FrameDecoder({ maxBytes: MAX_FRAME_BYTES });
  function shutdown() {
    if (closing) return;
    closing = true;
    handle.abortAll();
  }
  function dispatch(request) {
    if (closing) return;
    if (tasks.size >= maxTasks) { writeMessage(errorMessage(request?.id ?? null, "host_busy", safeMessage("host_busy"))); return; }
    // handle reserves the request ID synchronously before its first await. The task remains tracked until its response settles.
    const task = handle(request).then((response) => { writeMessage(response); }, (error) => { writeMessage(errorMessage(request?.id ?? null, safeErrorCode(error), safeMessage(safeErrorCode(error)))); }).then(() => tasks.delete(task));
    tasks.add(task);
  }
  input.on("data", (chunk) => {
    if (closing) return;
    try { for (const request of decoder.push(chunk)) dispatch(request); }
    catch (error) { stderr.write(`native-host: ${safeErrorCode(error)}\n`); shutdown(); input.destroy(); }
  });
  input.on("end", () => { try { decoder.finish(); } catch (error) { stderr.write(`native-host: ${safeErrorCode(error)}\n`); } shutdown(); });
  input.on("close", shutdown);
  input.on("error", () => shutdown());
  output.on?.("error", () => shutdown());
  return 0;
}

const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) process.exitCode = runNativeHost();
