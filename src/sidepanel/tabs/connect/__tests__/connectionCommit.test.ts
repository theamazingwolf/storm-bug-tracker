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
  const inspection = (viewerId: string, organization = org("org-1", "One")) => ({ viewer: { id: viewerId, name: "Same" }, organization });
  const snapshot = () => JSON.stringify({
    c: state().connections, s: state().selectedConnectionIds, a: state().accounts, p: state().destinationProfiles, m: state().websiteOriginMappings,
  });
  const inspectCalls = () => sendBg.mock.calls.map(([r]) => r).filter((r) => r.type === "linear.inspectAuth");

  it("stores the same viewer as independent connections in distinct workspaces, selection unchanged", async () => {
    sendBg.mockResolvedValueOnce(inspection("u-1", org("org-1", "One"))).mockResolvedValueOnce(inspection("u-1", org("org-2", "Two")));
    const a = await commitLinearAccount(lin("Same", "k1", "u-1"));
    const b = await commitLinearAccount(lin("Same", "k2", "u-1"));
    expect(a).not.toBe(b);
    expect(state().connections.linear.map((c) => c.organization)).toEqual([org("org-1", "One"), org("org-2", "Two")]);
    expect(state().selectedConnectionIds.linear).toBe(a);
    expect(state().accounts.linear?.auth).toMatchObject({ apiKey: "k1" });
  });

  it("inspects the NEW credential only: no connectionId, and the store is untouched while the lookup is pending", async () => {
    const before = snapshot();
    let during: string | undefined;
    sendBg.mockImplementation(async () => {
      during = snapshot();
      return inspection("u-1");
    });
    const id = await commitLinearAccount(lin("Same", "k1", "u-1"));
    expect(sendBg).toHaveBeenCalledTimes(1);
    expect(sendBg.mock.calls[0][0]).toEqual({ type: "linear.inspectAuth", auth: lin("Same", "k1", "u-1").auth });
    expect(during).toBe(before);
    expect(state().getConnection("linear", id)?.organization).toEqual(org("org-1", "One"));
  });

  it("stamps the provider-proven viewer id when the incoming credential carries none", async () => {
    sendBg.mockResolvedValue(inspection("u-7"));
    const id = await commitLinearAccount(lin("Same", "k1"));
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ viewerId: "u-7" });
  });

  it("changes nothing when the lookup fails, answers malformed, or contradicts the claimed viewer id", async () => {
    const before = snapshot();
    sendBg.mockRejectedValueOnce(new Error("network"));
    await expect(commitLinearAccount(lin("Same", "k1", "u-1"))).rejects.toThrow("network");
    sendBg.mockResolvedValueOnce(inspection("u-1", org("", "x")));
    expect(await codeOf(commitLinearAccount(lin("Same", "k1", "u-1")))).toBe("invalid-organization");
    sendBg.mockResolvedValueOnce({ viewer: { id: " ", name: "x" }, organization: org("org-1") });
    expect(await codeOf(commitLinearAccount(lin("Same", "k1", "u-1")))).toBe("identity-unverified");
    sendBg.mockResolvedValueOnce(inspection("u-OTHER"));
    expect(await codeOf(commitLinearAccount(lin("Same", "k1", "u-1")))).toBe("identity-unverified");
    expect(snapshot()).toBe(before);
    expect(state().connections.linear).toEqual([]);
  });

  it("refuses a duplicate of the same viewer in the same workspace", async () => {
    sendBg.mockResolvedValue(inspection("u-1"));
    await commitLinearAccount(lin("Same", "k1", "u-1"));
    const before = snapshot();
    expect(await codeOf(commitLinearAccount(lin("Same", "k1b", "u-1")))).toBe("duplicate-connection");
    expect(snapshot()).toBe(before);
  });

  it("reconnect keeps the old credential until the new one is proven, then swaps it on the same record", async () => {
    sendBg.mockResolvedValueOnce(inspection("u-1"));
    const id = await commitLinearAccount(lin("Same", "old", "u-1"));
    state().updateConnection("linear", id, { defaults: { teamId: "t1" } });
    let oldKeyDuringLookup: string | undefined;
    let count = 0;
    sendBg.mockImplementationOnce(async () => {
      oldKeyDuringLookup = (state().getConnection("linear", id)!.account.auth as { apiKey: string }).apiKey;
      count = state().connections.linear.length;
      return inspection("u-1");
    });
    await commitLinearAccount(lin("Same Renamed", "new", "u-1"), id);
    expect(oldKeyDuringLookup).toBe("old");
    expect(count).toBe(1);
    expect(state().connections.linear.map((c) => c.id)).toEqual([id]);
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "new", viewerName: "Same Renamed" });
    expect(state().getConnection("linear", id)?.account.defaults).toEqual({ teamId: "t1" });
    expect(state().selectedConnectionIds.linear).toBe(id);
  });

  it("a same-user workspace switch or a different user preserves the old token and adds no record", async () => {
    sendBg.mockResolvedValueOnce(inspection("u-1"));
    const id = await commitLinearAccount(lin("Alex", "old", "u-1"));
    const before = snapshot();
    sendBg.mockResolvedValueOnce(inspection("u-1", org("org-2", "Two")));
    expect(await codeOf(commitLinearAccount(lin("Alex", "other-workspace", "u-1"), id))).toBe("organization-mismatch");
    sendBg.mockResolvedValueOnce(inspection("u-2"));
    expect(await codeOf(commitLinearAccount(lin("Alex", "impostor", "u-2"), id))).toBe("account-mismatch");
    expect(snapshot()).toBe(before);
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "old" });
  });

  it("never resurrects a reconnect target deleted while the lookup was pending", async () => {
    sendBg.mockResolvedValueOnce(inspection("u-1"));
    const id = await commitLinearAccount(lin("Same", "old", "u-1"));
    sendBg.mockImplementationOnce(async () => {
      state().removeConnection("linear", id);
      return inspection("u-1");
    });
    expect(await codeOf(commitLinearAccount(lin("Same", "new", "u-1"), id))).toBe("unknown-connection");
    expect(state().connections.linear).toEqual([]);
    expect(state().selectedConnectionIds.linear).toBeUndefined();
  });

  it("legacy record: proves the old identity through its stored credential first, with no mutation before proof", async () => {
    const id = state().addConnection("linear", lin("Same", "old"));
    let duringInspect: string | undefined;
    sendBg.mockImplementation(async (req: { type: string }) => {
      if (req.type === "linear.getMyself") return { id: "u-1", name: "Same" };
      duringInspect = snapshot();
      return inspection("u-1");
    });
    const before = snapshot();
    await commitLinearAccount(lin("Same", "new", "u-1"), id);
    expect(sendBg.mock.calls[0][0]).toEqual({ type: "linear.getMyself", connectionId: id });
    expect(duringInspect).toBe(before);
    expect(state().getConnection("linear", id)).toMatchObject({ organization: org("org-1", "One"), account: { auth: { apiKey: "new", viewerId: "u-1" } } });
  });

  it("legacy record: failed or mismatching proof fails closed, and a failed proof never reaches the credential lookup", async () => {
    const id = state().addConnection("linear", lin("Same", "old"));
    const before = snapshot();
    sendBg.mockRejectedValueOnce(new Error("401"));
    expect(await codeOf(commitLinearAccount(lin("Same", "new", "u-1"), id))).toBe("identity-unverified");
    expect(inspectCalls()).toHaveLength(0);
    sendBg.mockReset();
    sendBg.mockImplementation(async (req: { type: string }) =>
      req.type === "linear.getMyself" ? { id: "u-9", name: "Same" } : inspection("u-1"),
    );
    expect(await codeOf(commitLinearAccount(lin("Same", "new", "u-1"), id))).toBe("account-mismatch");
    expect(snapshot()).toBe(before);
  });

  it("unknown connection id fails before any network call", async () => {
    expect(await codeOf(commitLinearAccount(lin("Same", "k", "u-1"), "linear-ghost"))).toBe("unknown-connection");
    expect(sendBg).not.toHaveBeenCalled();
  });

  describe("abandoned attempts", () => {
    function pending() {
      let release!: (v: unknown) => void;
      sendBg.mockImplementationOnce(() => new Promise((r) => (release = r)));
      return { release: (v: unknown) => release(v) };
    }
    const aborted = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (err) {
        return (err as Error).name;
      }
      return "resolved";
    };

    it("abort while the org check is pending leaves connections, selection, profiles and defaults unchanged (add)", async () => {
      sendBg.mockResolvedValueOnce(inspection("u-0", org("org-0", "Zero")));
      const keep = await commitLinearAccount(lin("Keep", "k0", "u-0"));
      state().updateConnection("linear", keep, { defaults: { teamId: "t0" } });
      state().saveDestinationProfile({ id: "d", platform: "linear", connectionId: keep, organizationId: "org-0", teamId: "t0" });
      const before = snapshot();
      const p = pending();
      const ctrl = new AbortController();
      const run = commitLinearAccount(lin("New", "k1", "u-1"), undefined, ctrl.signal);
      ctrl.abort();
      p.release(inspection("u-1", org("org-1", "One")));
      expect(await aborted(run)).toBe("AbortError");
      expect(snapshot()).toBe(before);
      expect(JSON.stringify(state().connections)).not.toContain("k1");
    });

    it("abort while the org check is pending preserves the old token (reconnect)", async () => {
      sendBg.mockResolvedValueOnce(inspection("u-1"));
      const id = await commitLinearAccount(lin("Same", "old", "u-1"));
      const before = snapshot();
      const p = pending();
      const ctrl = new AbortController();
      const run = commitLinearAccount(lin("Same", "new", "u-1"), id, ctrl.signal);
      ctrl.abort();
      p.release(inspection("u-1"));
      expect(await aborted(run)).toBe("AbortError");
      expect(snapshot()).toBe(before);
      expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "old" });
    });

    it("abort while the legacy identity proof is pending never reaches the credential lookup or a write", async () => {
      const id = state().addConnection("linear", lin("Same", "old"));
      const before = snapshot();
      const p = pending();
      const ctrl = new AbortController();
      const run = commitLinearAccount(lin("Same", "new", "u-1"), id, ctrl.signal);
      ctrl.abort();
      p.release({ id: "u-1", name: "Same" });
      expect(await aborted(run)).toBe("AbortError");
      expect(inspectCalls()).toHaveLength(0);
      expect(snapshot()).toBe(before);
    });

    it("an already-aborted signal makes no call at all", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      expect(await aborted(commitLinearAccount(lin("Same", "k", "u-1"), undefined, ctrl.signal))).toBe("AbortError");
      expect(sendBg).not.toHaveBeenCalled();
    });

    it("GitHub: abort during the legacy proof leaves the old credential", async () => {
      const id = await commitGithubAccount(gh("legacy", "old"));
      const before = snapshot();
      const p = pending();
      const ctrl = new AbortController();
      const run = commitGithubAccount(gh("legacy", "new", 7), id, ctrl.signal);
      ctrl.abort();
      p.release({ login: "legacy", id: 7 });
      expect(await aborted(run)).toBe("AbortError");
      expect(snapshot()).toBe(before);
    });
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
