import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindConnectionId } from "../lib/connectionAuthContext";
import { githubFetch } from "../github-api";
import { refreshGithubToken } from "../github-oauth";
import { getMyself as getLinearMyself } from "../linear-api";
import { refreshLinearToken } from "../linear-oauth";
import { SETTINGS_STORAGE_KEY } from "@/lib/settings-storage";

// Importing the OAuth modules installs their refresh hooks on the API runners.
void refreshGithubToken;
void refreshLinearToken;

const githubAuth = { kind: "oauth", accessToken: "gh-access", refreshToken: "gh-refresh", expiresAt: 0, tokenType: "bearer", scope: "repo", viewerId: 42, viewerLogin: "octo", grantedAt: 10 } as const;
const linearAuth = { kind: "oauth", accessToken: "ln-access", refreshToken: "ln-refresh", expiresAt: 0, scope: "read", viewerId: "viewer-1", viewerName: "A. User", grantedAt: 10 } as const;

beforeEach(() => {
  vi.stubEnv("VITE_GITHUB_CLIENT_ID", "github-client");
  vi.stubEnv("VITE_LINEAR_CLIENT_ID", "linear-client");
  vi.stubEnv("VITE_OAUTH_PROXY_URL", "https://oauth.example");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("refresh endpoints require the exact captured connection grant", () => {
  it.each([
    { platform: "github", current: null },
    { platform: "github", current: { ...githubAuth, grantedAt: 20, refreshToken: "new-grant" } },
    { platform: "linear", current: null },
    { platform: "linear", current: { ...linearAuth, grantedAt: 20, refreshToken: "new-grant" } },
  ] as const)("$platform does not call its provider when the record is missing or grant changed", async ({ platform, current }) => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: "unexpected" }) }) as Response);
    vi.stubGlobal("fetch", fetch);
    const record = current ? [{ id: "connection-1", account: { auth: current } }] : [];
    vi.stubGlobal("chrome", {
      storage: { local: { get: async (key: string) => ({ [key]: key === SETTINGS_STORAGE_KEY ? { state: { connections: { [platform]: record }, accounts: {}, selectedConnectionIds: { [platform]: "connection-1" } } } : undefined }), set: vi.fn(), remove: vi.fn() } },
    });

    if (platform === "github") {
      await expect(githubFetch(bindConnectionId(githubAuth, "connection-1"), "/user")).rejects.toThrow("connection changed during token refresh");
    } else {
      await expect(getLinearMyself(bindConnectionId(linearAuth, "connection-1"))).rejects.toThrow("connection changed during token refresh");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
