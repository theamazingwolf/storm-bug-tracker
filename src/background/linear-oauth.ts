import { inConnectLane } from "./lib/connectLane";
import { t } from "@/i18n";
import type { LinearAuth, LinearOAuthAuth } from "@/types/linear";
import { resolveStoredLinearConnectionAuth, writeStoredLinearOAuthTokens } from "@/lib/settings-storage";
import { pickRotatedAuth } from "./lib/rotatedAuth";
import { bindConnectionId, connectionIdFromAuth, oauthGrantIdentity } from "./lib/connectionAuthContext";
import { createConnectionRefreshFlights } from "./lib/connectionRefreshFlights";
import { getMyself, setLinearRefreshHook } from "./linear-api";
import { OAuthError, authorizeRejection, base64url, grantRejection, httpReason, launchOAuthWebFlow } from "./oauth";
import {
  OAUTH_CONFIG,
  assertConfigured as assertOAuthConfigured,
  isCancellation,
} from "./oauth/config";

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";
const SCOPES = ["read", "write", "issues:create"];

function assertConfigured(): void {
  assertOAuthConfigured(OAUTH_CONFIG.linear);
}

function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export async function generatePkceChallenge(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64url(bytes.buffer);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = base64url(hash);
  return { codeVerifier, codeChallenge };
}

export function isLinearCancellationCode(code: string | null): boolean {
  return isCancellation(OAUTH_CONFIG.linear, code);
}

export interface ParsedLinearCallback {
  code: string;
}

export function parseLinearCallbackParams(
  redirectUrl: string,
  expectedState: string,
): ParsedLinearCallback {
  const parsed = new URL(redirectUrl);
  const errorParam = parsed.searchParams.get("error");
  if (errorParam) {
    throw new OAuthError(
      parsed.searchParams.get("error_description") || errorParam,
      { platform: "linear", ...authorizeRejection(isLinearCancellationCode(errorParam)) },
    );
  }
  const returnedState = parsed.searchParams.get("state");
  if (returnedState !== expectedState) {
    throw new OAuthError(t("oauth.error.stateMismatch"), { platform: "linear" });
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new OAuthError(t("oauth.error.codeMissing"), { platform: "linear" });
  }
  return { code };
}

interface LinearTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string[];
}

export async function startLinearOAuth(): Promise<LinearOAuthAuth> {
  assertConfigured();
  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = await generatePkceChallenge();

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", OAUTH_CONFIG.linear.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");

  const redirect = await launchOAuthWebFlow(url.toString(), "linear");
  if (!redirect) {
    throw new OAuthError(t("oauth.error.cancelled"), {
      platform: "linear",
      cancelled: true,
      reason: "cancelled_window",
    });
  }

  const { code } = parseLinearCallbackParams(redirect, state);
  const tokens = await exchangeCode(code, codeVerifier);

  const auth: LinearOAuthAuth = {
    kind: "oauth",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: Array.isArray(tokens.scope) ? tokens.scope.join(",") : String(tokens.scope),
    viewerName: "",
    grantedAt: Date.now(),
  };
  const me = await inConnectLane(() => getMyself(auth));
  return { ...auth, viewerName: me.name, viewerId: me.id, viewerEmail: me.email };
}

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<LinearTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OAUTH_CONFIG.linear.clientId,
      redirect_uri: redirectUri(),
      code,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenExchange", { status: res.status, text }),
      { platform: "linear", reason: httpReason(res.status) },
    );
  }
  const data = (await res.json()) as LinearTokenResponse | { error?: string; error_description?: string };
  if ("error" in data && data.error) {
    throw new OAuthError(data.error_description || data.error, {
      platform: "linear",
      ...grantRejection(isLinearCancellationCode(data.error)),
    });
  }
  return data as LinearTokenResponse;
}

export async function refreshLinearToken(
  auth: LinearAuth,
): Promise<LinearAuth> {
  if (auth.kind !== "oauth") return auth;
  assertConfigured();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OAUTH_CONFIG.linear.clientId,
      refresh_token: auth.refreshToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new OAuthError(
      t("oauth.error.tokenRefresh", { status: res.status, text }),
      { platform: "linear", reason: httpReason(res.status) },
    );
  }
  const rData = (await res.json()) as LinearTokenResponse | { error?: string; error_description?: string };
  if ("error" in rData && rData.error) {
    throw new OAuthError(rData.error_description || rData.error, {
      platform: "linear",
    });
  }
  const tokens = rData as LinearTokenResponse;
  const refreshed: LinearOAuthAuth = {
    ...auth,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: Array.isArray(tokens.scope) ? tokens.scope.join(",") : String(tokens.scope),
  };
  await persistLinearOAuthTokens(refreshed);
  return refreshed;
}

export async function persistLinearOAuthTokens(
  auth: LinearOAuthAuth,
): Promise<void> {
  try {
    const saved = await writeStoredLinearOAuthTokens(auth, connectionIdFromAuth(auth));
    if (saved === false) throw new Error("The Linear connection changed or was removed during token refresh.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new OAuthError(t("oauth.error.tokenPersist", { message }), {
      platform: "linear",
    });
  }
}

const refreshFlights = createConnectionRefreshFlights<LinearAuth>();

async function refreshOnceWithLock(auth: LinearAuth): Promise<LinearAuth> {
  if (auth.kind !== "oauth") return auth;
  const connectionId = connectionIdFromAuth(auth) ?? "legacy-linear";
  const grant = oauthGrantIdentity(auth);
  return refreshFlights(connectionId, grant, async () => {
    const storedResult = await resolveStoredLinearConnectionAuth(connectionId).catch(() => ({ status: "missing" as const }));
    const stored = storedResult.status === "resolved" ? storedResult.auth : null;
    const sameGrant = stored?.kind === "oauth" && oauthGrantIdentity(stored) === grant;
    const rotated = sameGrant ? pickRotatedAuth(auth, stored) : null;
    if (rotated) return bindConnectionId(rotated, connectionId);
    return refreshLinearToken(bindConnectionId(auth, connectionId));
  });
}

setLinearRefreshHook(refreshOnceWithLock);
