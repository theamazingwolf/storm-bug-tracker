import { beforeEach, describe, expect, it, vi } from "vitest";

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (req: unknown) => sendBg(req) }));

import { ConnectionSettingsError } from "@/lib/connection-settings";
import { useSettingsStore } from "@/store/settings-store";
import type { GithubAccount } from "@/types/github";
import type { LinearAccount } from "@/types/linear";
import { commitGithubAccount, commitLinearAccount, verifyLinearOrganization } from "../connectionCommit";

const gh = (login: string, pat: string, viewerId?: number): GithubAccount => ({
  platform: "github",
  connectedAt: 1,
  auth: { kind: "pat", pat, viewerLogin: login, ...(viewerId !== undefined ? { viewerId } : {}) },
  defaults: {},
});
const lin = (name: string, apiKey: string, viewerId?: string): LinearAccount => ({
  platform: "linear",
  connectedAt: 1,
  auth: { kind: "apiKey", apiKey, viewerName: name, viewerEmail: "same@example.test", ...(viewerId !== undefined ? { viewerId } : {}) },
  defaults: {},
});

const state = () => useSettingsStore.getState();
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ConnectionSettingsError);
    return (err as ConnectionSettingsError).code;
  }
  throw new Error("expected rejection");
}

beforeEach(() => {
  sendBg.mockReset();
  useSettingsStore.setState({
    accounts: {}, lastSubmitFields: {}, connections: { github: [], linear: [] },
    selectedConnectionIds: {}, destinationProfiles: [], websiteOriginMappings: [],
  });
});

describe("commitGithubAccount", () => {
  it("adds a second account without replacing or re-selecting the first", async () => {
    const first = await commitGithubAccount(gh("one", "p1", 1));
    const second = await commitGithubAccount(gh("two", "p2", 2));
    expect(second).not.toBe(first);
    expect(state().connections.github.map((c) => c.id)).toEqual([first, second]);
    expect(state().selectedConnectionIds.github).toBe(first);
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("refuses to add the same immutable account twice, even under a new login", async () => {
    await commitGithubAccount(gh("one", "p1", 1));
    expect(await codeOf(commitGithubAccount(gh("one-renamed", "p1b", 1)))).toBe("duplicate-connection");
    expect(state().connections.github).toHaveLength(1);
  });

  it("allows two different ids that share a display login only through the login fallback for legacy records", async () => {
    await commitGithubAccount(gh("legacy", "p1"));
    expect(await codeOf(commitGithubAccount(gh("Legacy", "p2", 5)))).toBe("duplicate-connection");
    await commitGithubAccount(gh("other", "p3", 6));
    expect(state().connections.github).toHaveLength(2);
  });

  it("reconnects the exact record by id without any provider call when the id is stored", async () => {
    const a = await commitGithubAccount(gh("one", "old", 1));
    const b = await commitGithubAccount(gh("two", "p2", 2));
    await commitGithubAccount(gh("one-renamed", "new", 1), a);
    expect(state().getConnection("github", a)?.account.auth).toMatchObject({ pat: "new", viewerLogin: "one-renamed" });
    expect(state().getConnection("github", b)?.account.auth).toMatchObject({ pat: "p2" });
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("rejects a reconnect with a different account and keeps the stored credential", async () => {
    const a = await commitGithubAccount(gh("one", "old", 1));
    expect(await codeOf(commitGithubAccount(gh("one", "stolen", 2), a))).toBe("account-mismatch");
    expect(state().getConnection("github", a)?.account.auth).toMatchObject({ pat: "old" });
  });

  it("unknown connection id fails before any provider call", async () => {
    expect(await codeOf(commitGithubAccount(gh("one", "p", 1), "github-ghost"))).toBe("unknown-connection");
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("legacy record: proves the old identity with the stored credential, then reconnects", async () => {
    const id = await commitGithubAccount(gh("legacy", "old"));
    sendBg.mockResolvedValue({ login: "legacy", id: 7 });
    await commitGithubAccount(gh("legacy-renamed", "new", 7), id);
    expect(sendBg).toHaveBeenCalledWith({ type: "github.getMyself", connectionId: id });
    expect(state().getConnection("github", id)?.account.auth).toMatchObject({ pat: "new", viewerId: 7 });
  });

  it("legacy record: a different proven id, or a failed proof, leaves the record untouched", async () => {
    const id = await commitGithubAccount(gh("legacy", "old"));
    sendBg.mockResolvedValueOnce({ login: "legacy", id: 8 });
    expect(await codeOf(commitGithubAccount(gh("legacy", "new", 7), id))).toBe("account-mismatch");
    sendBg.mockRejectedValueOnce(new Error("401 from provider"));
    expect(await codeOf(commitGithubAccount(gh("legacy", "new", 7), id))).toBe("identity-unverified");
    expect(state().getConnection("github", id)?.account.auth).toMatchObject({ pat: "old" });
  });
});

describe("commitLinearAccount", () => {
  const org = (id: string, name = id) => ({ id, name });

  it("stores the same viewer as independent connections in distinct workspaces", async () => {
    sendBg.mockImplementation(async (req: { connectionId: string }) =>
      state().getConnection("linear", req.connectionId)?.account.auth.kind === "apiKey" &&
      (state().getConnection("linear", req.connectionId)!.account.auth as { apiKey: string }).apiKey === "k1"
        ? org("org-1", "One")
        : org("org-2", "Two"),
    );
    const a = await commitLinearAccount(lin("Same", "k1", "u-1"));
    const b = await commitLinearAccount(lin("Same", "k2", "u-1"));
    expect(a).not.toBe(b);
    expect(state().connections.linear.map((c) => c.organization)).toEqual([org("org-1", "One"), org("org-2", "Two")]);
    expect(state().selectedConnectionIds.linear).toBe(a);
  });

  it("reads the workspace through the candidate record's own id, which becomes the connection", async () => {
    sendBg.mockImplementation(async () => org("org-1", "One"));
    const id = await commitLinearAccount(lin("Same", "k1", "u-1"));
    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(sendBg).toHaveBeenCalledWith({ type: "linear.getOrganization", connectionId: id });
  });

  it("removes the candidate (and any auto-selection) when the workspace lookup fails", async () => {
    sendBg.mockRejectedValue(new Error("network"));
    await expect(commitLinearAccount(lin("Same", "k1", "u-1"))).rejects.toThrow("network");
    expect(state().connections.linear).toEqual([]);
    expect(state().selectedConnectionIds.linear).toBeUndefined();
    expect(state().accounts.linear).toBeUndefined();
  });

  it("rejects a malformed workspace response", async () => {
    sendBg.mockResolvedValue({ id: "", name: "x" });
    expect(await codeOf(commitLinearAccount(lin("Same", "k1", "u-1")))).toBe("invalid-organization");
    expect(state().connections.linear).toEqual([]);
  });

  it("refuses a duplicate of the same viewer in the same workspace and cleans up the candidate", async () => {
    sendBg.mockResolvedValue(org("org-1", "One"));
    await commitLinearAccount(lin("Same", "k1", "u-1"));
    expect(await codeOf(commitLinearAccount(lin("Same", "k1b", "u-1")))).toBe("duplicate-connection");
    expect(state().connections.linear).toHaveLength(1);
  });

  it("reconnect keeps the old credential until the new one is verified, then swaps it on the same record", async () => {
    sendBg.mockResolvedValueOnce(org("org-1", "One"));
    const id = await commitLinearAccount(lin("Same", "old", "u-1"));
    state().updateConnection("linear", id, { defaults: { teamId: "t1" } });
    let candidateSeen: string | undefined;
    let oldKeyDuringLookup: string | undefined;
    sendBg.mockImplementationOnce(async (req: { connectionId: string }) => {
      candidateSeen = req.connectionId;
      const target = state().getConnection("linear", id)!;
      oldKeyDuringLookup = (target.account.auth as { apiKey: string }).apiKey;
      return org("org-1", "One");
    });
    await commitLinearAccount(lin("Same Renamed", "new", "u-1"), id);
    expect(candidateSeen).toBeDefined();
    expect(candidateSeen).not.toBe(id);
    expect(oldKeyDuringLookup).toBe("old");
    expect(state().connections.linear.map((c) => c.id)).toEqual([id]);
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "new", viewerName: "Same Renamed" });
    expect(state().getConnection("linear", id)?.account.defaults).toEqual({ teamId: "t1" });
    expect(state().selectedConnectionIds.linear).toBe(id);
  });

  it("a same-user workspace switch never overwrites the binding", async () => {
    sendBg.mockResolvedValueOnce(org("org-1", "One"));
    const id = await commitLinearAccount(lin("Same", "old", "u-1"));
    sendBg.mockResolvedValueOnce(org("org-2", "Two"));
    expect(await codeOf(commitLinearAccount(lin("Same", "other-workspace", "u-1"), id))).toBe("organization-mismatch");
    expect(state().connections.linear).toHaveLength(1);
    expect(state().getConnection("linear", id)).toMatchObject({ organization: org("org-1", "One"), account: { auth: { apiKey: "old" } } });
  });

  it("a different user with the same display name cannot take over the record", async () => {
    sendBg.mockResolvedValueOnce(org("org-1", "One"));
    const id = await commitLinearAccount(lin("Alex", "old", "u-1"));
    sendBg.mockResolvedValueOnce(org("org-1", "One"));
    expect(await codeOf(commitLinearAccount(lin("Alex", "impostor", "u-2"), id))).toBe("account-mismatch");
    expect(state().connections.linear).toHaveLength(1);
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "old" });
  });

  it("legacy record: proves the old identity through its own stored credential before the candidate is staged", async () => {
    const id = state().addConnection("linear", lin("Same", "old"));
    sendBg.mockImplementation(async (req: { type: string; connectionId: string }) =>
      req.type === "linear.getMyself" ? { id: "u-1", name: "Same" } : org("org-1", "One"),
    );
    await commitLinearAccount(lin("Same", "new", "u-1"), id);
    expect(sendBg.mock.calls[0][0]).toEqual({ type: "linear.getMyself", connectionId: id });
    expect(state().getConnection("linear", id)).toMatchObject({ organization: org("org-1", "One"), account: { auth: { apiKey: "new", viewerId: "u-1" } } });
  });

  it("legacy record: failed or mismatching proof fails closed with explicit guidance code and no leftovers", async () => {
    const id = state().addConnection("linear", lin("Same", "old"));
    sendBg.mockRejectedValueOnce(new Error("401"));
    expect(await codeOf(commitLinearAccount(lin("Same", "new", "u-1"), id))).toBe("identity-unverified");
    expect(sendBg).toHaveBeenCalledTimes(1);
    sendBg.mockReset();
    sendBg.mockImplementation(async (req: { type: string }) =>
      req.type === "linear.getMyself" ? { id: "u-9", name: "Same" } : org("org-1", "One"),
    );
    expect(await codeOf(commitLinearAccount(lin("Same", "new", "u-1"), id))).toBe("account-mismatch");
    expect(state().connections.linear.map((c) => c.id)).toEqual([id]);
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "old" });
  });

  it("unknown connection id fails before any network call", async () => {
    expect(await codeOf(commitLinearAccount(lin("Same", "k", "u-1"), "linear-ghost"))).toBe("unknown-connection");
    expect(sendBg).not.toHaveBeenCalled();
  });
});

describe("verifyLinearOrganization", () => {
  it("fills in the workspace using the record's own id and fails closed for unknown ids", async () => {
    const id = state().addConnection("linear", lin("Same", "k"));
    sendBg.mockResolvedValue({ id: "org-1", name: "One" });
    await verifyLinearOrganization(id);
    expect(sendBg).toHaveBeenCalledWith({ type: "linear.getOrganization", connectionId: id });
    expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-1", name: "One" });
    sendBg.mockClear();
    expect(await codeOf(verifyLinearOrganization("linear-ghost"))).toBe("unknown-connection");
    expect(sendBg).not.toHaveBeenCalled();
  });
});
