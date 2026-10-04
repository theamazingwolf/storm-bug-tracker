import { createHash, randomBytes, randomUUID } from "node:crypto";
import { APP_NAME, AUTHORIZE_URL, CALLBACK_PATH, REQUIRED_SCOPES } from "./constants.js";

export function randomUrlToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createPkce() {
  const verifier = randomUrlToken(32);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createAuthAttempt({ clientId, hostId, redirectUri, newRegistration }) {
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const { verifier, challenge } = createPkce();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", newRegistration ? "dynamic_agent_client" : clientId);
  if (newRegistration) url.searchParams.set("agent_name_hint", APP_NAME);
  url.searchParams.set("ext_agent_host_id", hostId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", REQUIRED_SCOPES.join(" "));
  url.searchParams.set("resource", "https://api.openai.com/v1");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  return { id: randomUUID(), state, nonce, verifier, redirectUri, clientId, newRegistration, authorizeUrl: url.toString() };
}

export function validateCallback(rawUrl, attempt) {
  const url = new URL(rawUrl);
  if (url.origin !== new URL(attempt.redirectUri).origin || url.pathname !== CALLBACK_PATH) throw new Error("invalid_callback_route");
  if (url.searchParams.get("state") !== attempt.state) throw new Error("invalid_state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) throw new Error(oauthError === "access_denied" ? "authorization_denied" : "authorization_failed");
  const code = url.searchParams.get("code");
  if (!code || code.length > 8192) throw new Error("invalid_callback_code");
  const returnedClientId = url.searchParams.get("client_id");
  if (attempt.newRegistration && (!returnedClientId || returnedClientId === "dynamic_agent_client")) throw new Error("registration_incomplete");
  if (!attempt.newRegistration && returnedClientId && returnedClientId !== attempt.clientId) throw new Error("account_binding_mismatch");
  return { code, clientId: attempt.newRegistration ? returnedClientId : attempt.clientId };
}

export function parseScopes(scope) {
  return new Set(typeof scope === "string" ? scope.trim().split(/\s+/).filter(Boolean) : []);
}

const SAFE_INTERNAL_CODES = new Set([
  "authorization_cancelled", "authorization_denied", "authorization_timeout", "authorization_failed", "draft_timeout", "timeout",
  "browser_open_failed", "invalid_authorize_url", "invalid_state", "invalid_callback_route", "invalid_callback_code",
  "registration_incomplete", "account_binding_mismatch", "request_cancelled", "token_timeout",
  "token_http_400", "token_http_401", "token_http_403", "token_http_429", "token_http_500", "token_http_503",
  "invalid_grant", "plan_scope_not_granted", "invalid_token_response", "invalid_token_type", "invalid_host_id_record", "invalid_profile_record", "invalid_lock_owner", "unsafe_storage_path", "unsafe_profile_file", "unsafe_lock_path", "invalid_frame_size", "invalid_json_frame", "oversized_frame", "truncated_frame", "auth_superseded", "profile_already_exists", "profile_lock_owner_changed", "unsafe_install_directory", "unsafe_install_file", "install_target_conflict", "incomplete_existing_install", "unsupported_browser", "invalid_or_upstream_extension_id",
  "profile_not_found", "profile_not_signed_in", "profile_lock_busy", "refresh_token_race", "token_refresh_not_yet_allowed",
  "invalid_model_catalog", "invalid_stream_event", "truncated_stream_event", "response_incomplete",
  "response_failed", "stream_ended_without_completion", "empty_draft_result", "draft_timeout",
  "draft_output_too_large", "sse_input_too_large", "invalid_request", "invalid_params", "invalid_request_id",
  "unsupported_method", "invalid_profile_id", "invalid_model", "invalid_draft_text", "invalid_instructions",
  "instructions_too_large", "invalid_images", "images_unsupported", "invalid_cancel_request", "request_too_large",
  "duplicate_request_id", "host_busy", "response_too_large", "invalid_host_arguments", "unauthorized_extension_origin",
  "profile_not_selected", "refresh_store_required", "missing_response_stream", "invalid_identity_token",
  "token_http_404", "token_http_408", "token_http_409", "token_http_422", "token_http_502", "token_http_504",
  "http_400", "http_401", "http_403", "http_404", "http_408", "http_409", "http_422", "http_429", "http_500", "http_502", "http_503", "http_504", "invalid_request_error",
  "subscription_sharing_user_not_eligible", "subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported", "subscription_sharing_invalid_user",
  "subscription_sharing_user_unavailable", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context",
]);
export function safeErrorCode(error) {
  const messageCode = error instanceof Error && /^[a-z][a-z0-9_.-]{0,79}$/i.test(error.message) ? error.message : null;
  const raw = typeof error === "string" ? error : error?.code ?? messageCode ?? (error instanceof Error ? "request_failed" : "internal_error");
  const safe = String(raw).toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 80);
  if (SAFE_INTERNAL_CODES.has(safe)) return safe;
  return "request_failed";
}

// Derived from the public upstream manifest key at the upstream main revision checked 2026-10-04.
// This value exists only as a deny fixture/guard; it is never emitted or accepted as this fork's ID.
export const FORBIDDEN_UPSTREAM_EXTENSION_ID = "dhmffogmoohdjficicjjfolcheklngfm";
export function isExtensionId(value) {
  return typeof value === "string" && /^[a-p]{32}$/.test(value);
}
export function isForkExtensionId(value) {
  return isExtensionId(value) && value !== FORBIDDEN_UPSTREAM_EXTENSION_ID;
}

export function isSafeProfileId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}
