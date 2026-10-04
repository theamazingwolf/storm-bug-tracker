import { homedir } from "node:os";
import { join } from "node:path";
import { FrameDecoder, encodeFrame } from "./frames.js";
import { errorMessage, eventMessage, resultMessage, validateRequest } from "./protocol.js";
import { safeErrorCode, isForkExtensionId } from "./security.js";
import { ProfileStore } from "./profiles.js";
import { signIn } from "./oauth.js";
import { listModels, draft } from "./responses.js";
import { PLAN_SCOPE, MAX_REQUEST_BYTES } from "./constants.js";

const safeMessage = (code) => ({
  authorization_denied: "Sign-in was cancelled.", authorization_timeout: "Sign-in timed out. Try again.",
  plan_scope_not_granted: "ChatGPT plan access was not granted. Sign in again and approve plan usage.",
  subscription_sharing_usage_limit_exceeded: "ChatGPT plan usage is limited. Review usage in ChatGPT settings before trying again.",
  model_not_available: "That model is not available for the selected account. Refresh the model list.",
  images_unsupported: "Image input is not supported in this helper yet. Choose text-only drafting.",
  request_cancelled: "The request was cancelled.",
}[code] ?? "The request could not be completed. Check the helper status and try again.");

export function validateNativeOrigin(args) {
  if (!Array.isArray(args) || args.length !== 2 || !args[0].startsWith("--allowed-extension-id=")) throw new Error("invalid_host_arguments");
  const configured = args[0].slice("--allowed-extension-id=".length);
  const caller = args[1];
  if (!isForkExtensionId(configured) || caller !== `chrome-extension://${configured}/`) throw new Error("unauthorized_extension_origin");
  return configured;
}

export function createHostApplication({ store, signInImpl = signIn, modelsImpl = listModels, draftImpl = draft, fetchImpl = fetch, openBrowser, emit = () => {} }) {
  let activeProfileId = null;
  const inflight = new Map();
  async function getProfile(profileId) {
    const id = profileId ?? activeProfileId;
    if (!id) throw new Error("profile_not_selected");
    const profile = await store.get(id);
    if (!profile?.accessToken || !profile.refreshToken) throw new Error("profile_not_signed_in");
    if (!profile.scopes.includes(PLAN_SCOPE)) throw new Error("plan_scope_not_granted");
    return profile;
  }
  return async function handle(raw) {
    let request;
    try { request = validateRequest(raw); }
    catch (error) { return errorMessage(raw?.id ?? null, safeErrorCode(error), safeMessage(safeErrorCode(error))); }
    const { id, method, params } = request;
    if (inflight.has(String(id))) return errorMessage(id, "duplicate_request_id", safeMessage("duplicate_request_id"));
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
          const existing = params.profileId ? await store.get(params.profileId) : null;
          const hostId = await store.initialize();
          const controller = new AbortController(); inflight.set(String(id), { controller, profileId: params.profileId ?? activeProfileId });
          const signed = await signInImpl({ store, profileId: existing?.profileId, clientId: existing?.clientId, hostId, newRegistration: !existing, fetchImpl, openBrowser, signal: controller.signal });
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
          const profile = await getProfile(params.profileId);
          const models = await modelsImpl({ profile, store, fetchImpl });
          result = { profileId: profile.profileId, models };
          break;
        }
        case "draft": {
          const profile = await getProfile(params.profileId);
          const controller = new AbortController(); inflight.set(String(id), { controller, profileId: profile.profileId });
          const value = await draftImpl({ profile, model: params.model, text: params.text, store, fetchImpl, signal: controller.signal, onDelta: (delta) => emit(eventMessage("draftDelta", { requestId: id, delta })) });
          result = { profileId: profile.profileId, text: value.text, completed: value.completed === true };
          break;
        }
        case "cancel": {
          const pending = inflight.get(String(params.requestId));
          if (pending) pending.controller.abort();
          result = { requestId: params.requestId, cancelled: Boolean(pending) };
          break;
        }
        case "signOut": {
          for (const pending of inflight.values()) if (pending.profileId === params.profileId) pending.controller.abort();
          const removed = await store.removeTokens(params.profileId);
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
    } finally { if (request) inflight.delete(String(id)); }
  };
}

export function runNativeHost({ input = process.stdin, output = process.stdout, stderr = process.stderr, args = process.argv.slice(2), env = process.env, store } = {}) {
  try { validateNativeOrigin(args); }
  catch (error) { stderr.write(`native-host: ${safeErrorCode(error)}\n`); return 2; }
  const dataDir = env.STORM_BUG_TRACKER_CHATGPT_HOME ?? join(homedir(), ".config", "storm-bug-tracker", "chatgpt");
  const profileStore = store ?? new ProfileStore(dataDir);
  const handle = createHostApplication({ store: profileStore, emit: (message) => output.write(encodeFrame(message)) });
  const decoder = new FrameDecoder({ maxBytes: MAX_REQUEST_BYTES });
  let closing = false;
  input.on("data", async (chunk) => {
    if (closing) return;
    try {
      for (const request of decoder.push(chunk)) {
        const response = await handle(request);
        output.write(encodeFrame(response));
      }
    } catch (error) {
      closing = true;
      stderr.write(`native-host: ${safeErrorCode(error)}\n`);
      input.destroy();
    }
  });
  input.on("end", () => { try { decoder.finish(); } catch (error) { stderr.write(`native-host: ${safeErrorCode(error)}\n`); } });
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = runNativeHost();
