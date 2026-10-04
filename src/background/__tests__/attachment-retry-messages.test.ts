import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatedDestination } from "@/types/attachment";
import type { BgRequest } from "@/types/messages";

const stored = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, connections: { github: {} as Record<string, unknown>, linear: {} as Record<string, unknown> } }));
const oauthMocks = vi.hoisted(() => ({ github: vi.fn(), linear: vi.fn() }));
vi.mock("../github-oauth", async (original) => ({ ...(await original<object>()), startGithubOAuth: oauthMocks.github }));
vi.mock("../linear-oauth", async (original) => ({ ...(await original<object>()), startLinearOAuth: oauthMocks.linear }));
vi.mock("@/lib/settings-storage", async (original) => ({
  ...(await original<object>()),
  readStoredAuth: vi.fn(async () => stored.auth.jira ?? null),
  readStoredGithubAuth: vi.fn(async () => stored.auth.github ?? null),
  resolveStoredGithubConnectionAuth: vi.fn(async (id?: string) => {
    if (id) return stored.connections.github[id] ? { status: "resolved", connectionId: id, auth: stored.connections.github[id] } : { status: "unknown" };
    const ids = Object.keys(stored.connections.github);
    if (ids.length > 1) return { status: "ambiguous" };
    return stored.auth.github ? { status: "resolved", connectionId: ids[0] ?? "legacy-github", auth: stored.auth.github } : { status: "missing" };
  }),
  resolveStoredLinearConnectionAuth: vi.fn(async (id?: string) => {
    if (id) return stored.connections.linear[id] ? { status: "resolved", connectionId: id, auth: stored.connections.linear[id], organization: { id: "org-1", name: "Org 1" } } : { status: "unknown" };
    const ids = Object.keys(stored.connections.linear);
    if (ids.length > 1) return { status: "ambiguous" };
    return stored.auth.linear ? { status: "resolved", connectionId: ids[0] ?? "legacy-linear", auth: stored.auth.linear } : { status: "missing" };
  }),
  readStoredGitlabAuth: vi.fn(async () => stored.auth.gitlab ?? null),
  readStoredLinearAuth: vi.fn(async () => stored.auth.linear ?? null),
  readStoredNotionAuth: vi.fn(async () => stored.auth.notion ?? null),
  readStoredAsanaAuth: vi.fn(async () => stored.auth.asana ?? null),
  readStoredClickupAuth: vi.fn(async () => stored.auth.clickup ?? null),
  readStoredSlackAuth: vi.fn(async () => stored.auth.slack ?? null),
}));
import { resolveStoredGithubConnectionAuth, resolveStoredLinearConnectionAuth } from "@/lib/settings-storage";
import { handleMessage } from "../messages";
import { BG_REQUEST_TYPES } from "../bgRequestTypes";
import { serializePlatformError } from "../platformErrors";

const AUTH = {
  jira: { kind: "oauth", cloudId: "cloud-1", siteUrl: "https://acme.atlassian.net", email: "a@b.c", accessToken: "t1", refreshToken: "r1", expiresAt: Date.now() + 3600_000 },
  github: { kind: "pat", pat: "p1", viewerLogin: "old-login" },
  gitlab: { kind: "pat", pat: "p1", baseUrl: "https://gitlab.example", viewerUsername: "u" },
  linear: { kind: "apiKey", apiKey: "k1", viewerName: "u" },
  notion: { kind: "oauth", accessToken: "t1", botId: "bot", workspaceId: "ws", workspaceName: "W", botName: "B", grantedAt: 1 },
  asana: { kind: "pat", pat: "p1", viewerGid: "u", viewerName: "u" },
  clickup: { kind: "pat", pat: "p1", viewerId: "u", viewerName: "u" },
  slack: { kind: "oauth", accessToken: "xoxp-1", viewerId: "U1", viewerName: "u", grantedAt: 1 },
} as const;
const DESTINATION: Record<keyof typeof AUTH, CreatedDestination> = {
  jira: { platform: "jira", key: "BUG-1", locator: { issueKey: "BUG-1", siteId: "cloud-1" } },
  github: { platform: "github", key: "#1", locator: { owner: "o", repo: "r", number: "1" } },
  gitlab: { platform: "gitlab", key: "#1", locator: { projectId: "4", iid: "1" } },
  linear: { platform: "linear", key: "L-1", locator: { issueId: "issue" } },
  notion: { platform: "notion", key: "abc", locator: { pageId: "page" } },
  asana: { platform: "asana", key: "task", locator: { taskGid: "task" } },
  clickup: { platform: "clickup", key: "task", locator: { taskId: "task" } },
  slack: { platform: "slack", key: "1.2", locator: { channelId: "C1", ts: "1.2" } },
};
// URL substring → JSON body. Order-independent so parallel reads stay deterministic.
function route(table: Array<[string, unknown]>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const hit = table.find(([part]) => String(url).includes(part));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const IDENTITY_ROUTES = (user: string): Record<keyof typeof AUTH, Array<[string, unknown]>> => ({
  jira: [["/rest/api/3/myself", { accountId: user }]],
  github: [["api.github.com/user", { id: Number(user.replace(/\D/g, "")) || 1, login: "renamed" }]],
  gitlab: [["/api/v4/user", { id: Number(user.replace(/\D/g, "")) || 1, username: "u" }]],
  linear: [["linear.app/graphql", { data: { viewer: { id: user }, organization: { id: "org" } } }]],
  notion: [],
  asana: [["/tasks/task", { data: { workspace: { gid: "ws" } } }], ["/users/me", { data: { gid: user } }]],
  clickup: [["/task/task", { team_id: "team" }], ["/user", { user: { id: user } }]],
  slack: [["auth.test", { ok: true, user_id: user, team_id: "T1", user: "u", team: "t" }]],
});
const identity = (platform: keyof typeof AUTH) => handleMessage({ type: `${platform}.getAccountIdentity`, destination: DESTINATION[platform] } as BgRequest, {}) as Promise<{ identity: string }>;

beforeEach(() => { stored.auth = { ...AUTH }; stored.connections.github = {}; stored.connections.linear = {}; });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("message registries", () => {
  const added = [
    ...["jira", "github", "gitlab", "linear", "notion", "asana", "clickup", "slack"].map((p) => `${p}.getAccountIdentity`),
    "github.getIssueBody", "github.updateIssueBody", "gitlab.getIssueDescription", "jira.getIssueAttachments",
    "linear.getIssueAttachments", "linear.inspectAuth", "notion.getBlockChildren", "notion.appendBlockChildren", "notion.deleteBlock", "notion.getFileUpload",
    "asana.getTaskAttachments", "clickup.getTaskAttachments", "slack.requestFileUpload", "slack.sendFileUpload", "slack.completeFileUploads",
  ];
  it.each(added)("routes %s through the allowlist", (type) => {
    expect(BG_REQUEST_TYPES.has(type)).toBe(true);
    expect(readFileSync("src/types/messages.ts", "utf8")).toContain(type.endsWith(".getAccountIdentity") ? ".getAccountIdentity" : `"${type}"`);
  });
  it("retires the batched Slack upload message from every routing layer", () => {
    for (const path of ["src/types/messages.ts", "src/background/messages.ts", "src/background/bgRequestTypes.ts"]) {
      expect(readFileSync(path, "utf8")).not.toContain('"slack.uploadFiles"');
    }
  });
});

describe("account identity", () => {
  it.each(Object.keys(AUTH) as Array<keyof typeof AUTH>)("%s resolves a stable identity from the current connection", async (platform) => {
    route(IDENTITY_ROUTES("user7")[platform]);
    const first = await identity(platform);
    expect(JSON.parse(first.identity)[0]).toBe(platform);
    expect(first.identity).not.toMatch(/xoxp|p1|k1|t1|old-login|renamed/);
    stored.auth = { ...AUTH, [platform]: { ...AUTH[platform], ...("accessToken" in AUTH[platform] ? { accessToken: "refreshed" } : {}), ...("pat" in AUTH[platform] ? { pat: "rotated" } : {}), ...("apiKey" in AUTH[platform] ? { apiKey: "rotated" } : {}) } };
    route(IDENTITY_ROUTES("user7")[platform]);
    expect((await identity(platform)).identity).toBe(first.identity);
  });

  it.each(["jira", "github", "gitlab", "linear", "asana", "clickup", "slack"] as const)("%s differs for another account", async (platform) => {
    route(IDENTITY_ROUTES("user7")[platform]);
    const first = await identity(platform);
    route(IDENTITY_ROUTES("user8")[platform]);
    expect((await identity(platform)).identity).not.toBe(first.identity);
  });

  it("uses the connected Jira site, so another site is another identity", async () => {
    route(IDENTITY_ROUTES("user7").jira);
    const first = await identity("jira");
    stored.auth = { ...AUTH, jira: { ...AUTH.jira, cloudId: "cloud-2" } };
    expect((await identity("jira")).identity).not.toBe(first.identity);
  });

  it("uses the GitLab base URL, so a self-managed origin is another identity", async () => {
    route(IDENTITY_ROUTES("user7").gitlab);
    const first = await identity("gitlab");
    stored.auth = { ...AUTH, gitlab: { ...AUTH.gitlab, baseUrl: "https://other.example" } };
    route([["/api/v4/user", { id: 7 }]]);
    expect((await identity("gitlab")).identity).not.toBe(first.identity);
  });

  it("uses stored OAuth IDs for Notion and the users/me workspace for an API key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(JSON.parse((await identity("notion")).identity)).toEqual(["notion", "ws", "bot"]);
    stored.auth = { ...AUTH, notion: { kind: "apiKey", token: "secret", botName: "B" } };
    route([["/users/me", { id: "bot-user", type: "bot", bot: { workspace_id: "ws2" } }]]);
    expect(JSON.parse((await identity("notion")).identity)).toEqual(["notion", "ws2", "bot-user"]);
  });

  it("rejects when the fixed Notion version omits the API-key workspace", async () => {
    stored.auth = { ...AUTH, notion: { kind: "apiKey", token: "secret", botName: "B" } };
    route([["/users/me", { id: "bot-user", type: "bot", bot: {} }]]);
    await expect(identity("notion")).rejects.toThrow();
  });

  it("rejects when the platform is disconnected", async () => {
    stored.auth = {};
    vi.stubGlobal("fetch", vi.fn());
    await expect(identity("github")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(Object.keys(AUTH) as Array<keyof typeof AUTH>)("a disconnected %s crosses the message boundary as 401 not_connected", async (platform) => {
    stored.auth = {};
    vi.stubGlobal("fetch", vi.fn());
    const error = await identity(platform).then(() => undefined, (e: unknown) => e);
    expect(serializePlatformError(error)).toMatchObject({ status: 401, body: { code: "not_connected" } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Slack staged upload handlers", () => {
  it("returns the allocation, sends one file's bytes and completes once", async () => {
    const fetch = route([
      ["files.getUploadURLExternal", { ok: true, file_id: "F1", upload_url: "https://files.slack.com/upload/v1/x" }],
      ["files.slack.com/upload", {}],
      ["files.completeUploadExternal", { ok: true, files: [{ id: "F1" }] }],
    ]);
    expect(await handleMessage({ type: "slack.requestFileUpload", filename: "a.txt", length: 1 }, {})).toEqual({ fileId: "F1", uploadUrl: "https://files.slack.com/upload/v1/x" });
    expect(await handleMessage({ type: "slack.sendFileUpload", uploadUrl: "https://files.slack.com/upload/v1/x", filename: "a.txt", dataUrl: "data:text/plain;base64,QQ==" }, {})).toEqual({ ok: true });
    expect(await handleMessage({ type: "slack.completeFileUploads", channelId: "C1", threadTs: "1.2", files: [{ id: "F1", title: "a.txt" }] }, {})).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([["internal_error", "ambiguous"], ["fatal_error", "ambiguous"], ["channel_not_found", "failed"]] as const)("reports complete %s as %s without calling it again", async (code, outcome) => {
    const fetch = route([["files.completeUploadExternal", { ok: false, error: code }]]);
    const result = await handleMessage({ type: "slack.completeFileUploads", channelId: "C1", threadTs: "1.2", files: [{ id: "F1", title: "a.txt" }] }, {});
    expect(result).toMatchObject({ ok: false, outcome, failure: { stage: "link" } });
    expect(JSON.stringify(result)).not.toContain(code);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("connection-scoped GitHub and Linear messages", () => {
  it("uses the explicit GitHub connection rather than the selected compatibility account", async () => {
    stored.connections.github.gh2 = { kind: "pat", pat: "pat-two", viewerLogin: "two", viewerId: 22 };
    const fetch = route([["api.github.com/user", { id: 22, login: "two", email: "two@example.com" }]]);
    await expect(handleMessage({ type: "github.getMyself", connectionId: "gh2" }, {})).resolves.toMatchObject({ id: 22, login: "two" });
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "token pat-two" });
    expect(vi.mocked(resolveStoredGithubConnectionAuth).mock.calls.at(-1)?.[0]).toBe("gh2");
  });

  it("fails closed for an explicit removed GitHub connection ID", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(handleMessage({ type: "github.getMyself", connectionId: "removed-id" }, {})).rejects.toThrow("no longer exists");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a no-ID GitHub request when multiple connections exist", async () => {
    stored.connections.github.gh1 = { kind: "pat", pat: "pat-one", viewerLogin: "one" };
    stored.connections.github.gh2 = { kind: "pat", pat: "pat-two", viewerLogin: "two" };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(handleMessage({ type: "github.getMyself" }, {})).rejects.toThrow("Multiple github connections");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the explicit Linear connection for provider-backed organization lookup", async () => {
    stored.connections.linear.lin2 = { kind: "apiKey", apiKey: "key-two", viewerName: "Same Viewer" };
    const fetch = route([["linear.app/graphql", { data: { organization: { id: "org-two", name: "Org Two" } } }]]);
    await expect(handleMessage({ type: "linear.getOrganization", connectionId: "lin2" }, {})).resolves.toEqual({ id: "org-two", name: "Org Two" });
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "key-two" });
    expect(vi.mocked(resolveStoredLinearConnectionAuth).mock.calls.at(-1)?.[0]).toBe("lin2");
  });

  it("forwards the captured connection through an existing-issue update", async () => {
    stored.connections.github.gh2 = { kind: "pat", pat: "pat-two", viewerLogin: "two", viewerId: 22 };
    const fetch = route([["/repos/o/r/issues/1", { body: "patched" }]]);
    await expect(handleMessage({ type: "github.updateIssueBody", connectionId: "gh2", owner: "o", repo: "r", number: 1, body: "patched" }, {})).resolves.toEqual({ ok: true });
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "token pat-two" });
  });

  it("forwards the captured Linear connection through issue status updates", async () => {
    stored.connections.linear.lin2 = { kind: "apiKey", apiKey: "key-two", viewerName: "Same Viewer" };
    const fetch = route([["linear.app/graphql", { data: { issueUpdate: { success: true, issue: {
      id: "issue-2", identifier: "L-2", title: "Issue", url: "https://linear.app/acme/issue/L-2", state: { name: "Done", type: "completed" }, labels: { nodes: [] },
    } } } }]]);
    await expect(handleMessage({ type: "linear.updateIssueState", connectionId: "lin2", issueId: "issue-2", stateId: "done" }, {})).resolves.toMatchObject({ id: "issue-2", state: { name: "Done" } });
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "key-two" });
  });
});

describe("raw Linear credential inspection", () => {
  it("checks only the supplied candidate auth and never falls back to stored connections", async () => {
    const before = structuredClone(stored);
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ errors: [{ message: "Authentication required" }] }), { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const candidate = { kind: "oauth", accessToken: "expired-candidate", refreshToken: "candidate-refresh", expiresAt: 0, scope: "read", viewerName: "", grantedAt: 9 } as const;
    await expect(handleMessage({ type: "linear.inspectAuth", auth: candidate }, {})).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://api.linear.app/graphql");
    expect((fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer expired-candidate" });
    expect(vi.mocked(resolveStoredLinearConnectionAuth)).not.toHaveBeenCalled();
    expect(stored).toEqual(before);
  });
});

describe("OAuth reconnect identity validation", () => {
  it("does not use a matching GitHub login as a substitute for immutable ID", async () => {
    stored.connections.github.gh1 = { kind: "pat", pat: "old-pat", viewerLogin: "same-login" };
    oauthMocks.github.mockResolvedValue({ kind: "oauth", accessToken: "new-token", tokenType: "bearer", scope: "repo", viewerLogin: "same-login", viewerId: 6, grantedAt: 20 });
    route([["api.github.com/user", { id: 5, login: "same-login", email: "u@example.com" }]]);
    await expect(handleMessage({ type: "github.startOAuth", connectionId: "gh1" }, {})).rejects.toThrow("Add this account as a new connection");
  });

  it("validates Linear organization from the new token before allowing reconnect", async () => {
    stored.connections.linear.lin1 = { kind: "apiKey", apiKey: "old-key", viewerName: "Same Viewer" };
    oauthMocks.linear.mockResolvedValue({ kind: "oauth", accessToken: "new-token", refreshToken: "r", expiresAt: Date.now() + 3_600_000, scope: "read,write", viewerName: "Same Viewer", viewerId: "user-1", grantedAt: 20 });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string>)?.Authorization;
      const organization = authorization === "Bearer new-token" ? { id: "org-new", name: "New Org" } : { id: "org-old", name: "Old Org" };
      return new Response(JSON.stringify({ data: { viewer: { id: "user-1", name: "Same Viewer" }, organization } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(handleMessage({ type: "linear.startOAuth", connectionId: "lin1" }, {})).rejects.toThrow("organization");
    expect(fetch.mock.calls.some(([, init]) => (init?.headers as Record<string, string>)?.Authorization === "Bearer new-token")).toBe(true);
  });
});

describe("existing-issue read handlers", () => {
  it("reads and patches a GitHub body of the destination issue", async () => {
    const fetch = route([["/repos/o/r/issues/1", { body: "remote" }]]);
    expect(await handleMessage({ type: "github.getIssueBody", owner: "o", repo: "r", number: 1 }, {})).toEqual({ body: "remote" });
    expect(await handleMessage({ type: "github.updateIssueBody", owner: "o", repo: "r", number: 1, body: "next" }, {})).toEqual({ ok: true });
    expect(fetch.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET")).toEqual(["GET", "PATCH"]);
  });

  it("deletes a Notion block only for an extension page sender", async () => {
    vi.stubGlobal("chrome", { runtime: { id: "ext" } });
    const fetch = route([["/blocks/b1", { id: "b1", archived: true }]]);
    await expect(handleMessage({ type: "notion.deleteBlock", blockId: "b1" }, { origin: "https://evil.example" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(await handleMessage({ type: "notion.deleteBlock", blockId: "b1" }, { origin: "chrome-extension://ext" })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns Notion append block IDs and refuses an oversized batch before any request", async () => {
    const fetch = route([["/blocks/page/children", { results: [{ id: "n1", type: "paragraph" }] }]]);
    expect(await handleMessage({ type: "notion.appendBlockChildren", blockId: "page", children: [{ type: "paragraph" }] }, {})).toEqual({ blockIds: ["n1"] });
    await expect(handleMessage({ type: "notion.appendBlockChildren", blockId: "page", children: Array(101).fill({ type: "paragraph" }) }, {})).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
