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

const SENSITIVE = /(?:access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|bearer|code_verifier|client_secret|\bcode\b|state|nonce)/i;
export function safeErrorCode(error) {
  const messageCode = error instanceof Error && /^[a-z][a-z0-9_.-]{0,79}$/i.test(error.message) ? error.message : null;
  const raw = typeof error === "string" ? error : error?.code ?? messageCode ?? (error instanceof Error ? "request_failed" : "internal_error");
  const safe = String(raw).toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 80);
  return SENSITIVE.test(safe) ? "request_failed" : safe || "request_failed";
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
