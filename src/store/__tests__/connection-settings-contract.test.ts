import { beforeEach, describe, expect, it } from "vitest";
import type { GithubAccount } from "@/types/github";
import type { LinearAccount } from "@/types/linear";
import { ConnectionSettingsError, canonicalMappingOrigin } from "@/lib/connection-settings";
import { matchWebsiteOrigin } from "@/lib/site-destination-routing";
import { useSettingsStore } from "../settings-store";

const gh = (login: string, pat = `pat-${login}`, viewerId?: number): GithubAccount => ({
  platform: "github",
  connectedAt: 10,
  auth: { kind: "pat", pat, viewerLogin: login, ...(viewerId !== undefined ? { viewerId } : {}) },
  defaults: {},
});
const lin = (name: string, key: string, viewerId?: string, email = "same@example.test"): LinearAccount => ({
  platform: "linear",
  connectedAt: 20,
  auth: { kind: "apiKey", apiKey: key, viewerName: name, viewerEmail: email, ...(viewerId !== undefined ? { viewerId } : {}) },
  defaults: {},
});

const state = () => useSettingsStore.getState();
const code = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConnectionSettingsError);
    return (err as ConnectionSettingsError).code;
  }
  return null;
};

beforeEach(() => useSettingsStore.setState({
  accounts: {}, lastSubmitFields: {}, connections: { github: [], linear: [] },
  selectedConnectionIds: {}, destinationProfiles: [], websiteOriginMappings: [],
}));

describe("canonicalMappingOrigin", () => {
  it.each([
    ["https://Example.com", "https://example.com"],
    ["https://example.com/", "https://example.com"],
    ["http://example.com:80", "http://example.com"],
    ["https://example.com:8443", "https://example.com:8443"],
    ["  https://app.example.com  ", "https://app.example.com"],
  ])("normalizes %s", (input, expected) => expect(canonicalMappingOrigin(input)).toBe(expected));

  it.each([
    "", "example.com", "ftp://example.com", "https://example.com/path", "https://example.com?x=1",
    "https://example.com#frag", "https://example.com/?", "https://user:pw@example.com",
    "https://*.example.com", "https://example.com\\path", "javascript:alert(1)", "chrome-extension://abc",
  ])("rejects %j", (input) => expect(canonicalMappingOrigin(input)).toBeNull());
});

describe("destination profiles", () => {
  it("upserts a GitHub profile by id and validates the connection", () => {
    const id = state().addConnection("github", gh("octo"));
    state().saveDestinationProfile({ id: "d1", platform: "github", connectionId: id, owner: "octo", repo: "mono" });
    state().saveDestinationProfile({ id: "d1", platform: "github", connectionId: id, owner: "octo", repo: "other" });
    expect(state().destinationProfiles).toEqual([{ id: "d1", platform: "github", connectionId: id, owner: "octo", repo: "other" }]);
  });

  it("rejects unknown connection, empty or path-like provider ids, and platform changes without mutating state", () => {
    const id = state().addConnection("github", gh("octo"));
    expect(code(() => state().saveDestinationProfile({ id: "d", platform: "github", connectionId: "nope", owner: "o", repo: "r" }))).toBe("unknown-connection");
    expect(code(() => state().saveDestinationProfile({ id: "d", platform: "github", connectionId: id, owner: " ", repo: "r" }))).toBe("invalid-destination");
    expect(code(() => state().saveDestinationProfile({ id: "d", platform: "github", connectionId: id, owner: "o", repo: "r/../x" }))).toBe("invalid-destination");
    expect(code(() => state().saveDestinationProfile({ id: "", platform: "github", connectionId: id, owner: "o", repo: "r" }))).toBe("invalid-destination");
    expect(state().destinationProfiles).toEqual([]);
    state().saveDestinationProfile({ id: "d", platform: "github", connectionId: id, owner: "o", repo: "r" });
    const linId = state().addConnection("linear", lin("V", "k"), { organization: { id: "org", name: "Org" } });
    expect(code(() => state().saveDestinationProfile({ id: "d", platform: "linear", connectionId: linId, organizationId: "org", teamId: "t" }))).toBe("platform-mismatch");
    expect(state().destinationProfiles).toHaveLength(1);
  });

  it("requires a known, matching Linear organization and nonempty team/project", () => {
    const noOrg = state().addConnection("linear", lin("V", "k0"));
    const withOrg = state().addConnection("linear", lin("V", "k1"), { organization: { id: "org-1", name: "One" } });
    const base = { id: "l", platform: "linear" as const, teamId: "team" };
    expect(code(() => state().saveDestinationProfile({ ...base, connectionId: noOrg, organizationId: "org-1" }))).toBe("organization-unverified");
    expect(code(() => state().saveDestinationProfile({ ...base, connectionId: withOrg, organizationId: "org-2" }))).toBe("organization-mismatch");
    expect(code(() => state().saveDestinationProfile({ ...base, connectionId: withOrg, organizationId: "org-1", teamId: "" }))).toBe("invalid-destination");
    expect(code(() => state().saveDestinationProfile({ ...base, connectionId: withOrg, organizationId: "org-1", projectId: " " }))).toBe("invalid-destination");
    expect(code(() => state().saveDestinationProfile({ ...base, connectionId: "ghost", organizationId: "org-1" }))).toBe("unknown-connection");
    state().saveDestinationProfile({ ...base, connectionId: withOrg, organizationId: "org-1", projectId: "p" });
    expect(state().destinationProfiles).toEqual([{ ...base, connectionId: withOrg, organizationId: "org-1", projectId: "p" }]);
  });

  it("keeps display-only Linear team/project names but drops project name without a project id", () => {
    const id = state().addConnection("linear", lin("V", "k"), { organization: { id: "org", name: "Org" } });
    state().saveDestinationProfile({ id: "l", platform: "linear", connectionId: id, organizationId: "org", teamId: "t", teamName: " Core ", teamKey: "CORE", projectName: "ghost" });
    expect(state().destinationProfiles[0]).toEqual({ id: "l", platform: "linear", connectionId: id, organizationId: "org", teamId: "t", teamName: "Core", teamKey: "CORE" });
  });

  it("removing a profile removes its mappings and keeps unrelated ones", () => {
    const id = state().addConnection("github", gh("octo"));
    state().saveDestinationProfile({ id: "a", platform: "github", connectionId: id, owner: "o", repo: "a" });
    state().saveDestinationProfile({ id: "b", platform: "github", connectionId: id, owner: "o", repo: "b" });
    state().setWebsiteOriginMapping("https://a.test", "a");
    state().setWebsiteOriginMapping("https://b.test", "b");
    state().removeDestinationProfile("a");
    expect(state().destinationProfiles.map((p) => p.id)).toEqual(["b"]);
    expect(state().websiteOriginMappings).toEqual([{ origin: "https://b.test", destinationId: "b" }]);
  });
});

describe("website origin mappings", () => {
  function twoDestinations() {
    const id = state().addConnection("github", gh("octo"));
    state().saveDestinationProfile({ id: "mono", platform: "github", connectionId: id, owner: "o", repo: "mono" });
    state().saveDestinationProfile({ id: "other", platform: "github", connectionId: id, owner: "o", repo: "other" });
  }

  it("round-trips and lets many origins share one monorepo destination", () => {
    twoDestinations();
    state().setWebsiteOriginMapping("https://a.test", "mono");
    state().setWebsiteOriginMapping("https://b.test/", "mono");
    state().setWebsiteOriginMapping("http://localhost:3000", "other");
    expect(state().websiteOriginMappings).toEqual([
      { origin: "https://a.test", destinationId: "mono" },
      { origin: "https://b.test", destinationId: "mono" },
      { origin: "http://localhost:3000", destinationId: "other" },
    ]);
    const m = matchWebsiteOrigin("https://b.test/some/path?x=1", state().websiteOriginMappings, state().destinationProfiles);
    expect(m.status).toBe("matched");
    state().removeWebsiteOriginMapping("https://a.test");
    expect(state().websiteOriginMappings.map((x) => x.origin)).toEqual(["https://b.test", "http://localhost:3000"]);
  });

  it("replace removes every old rule for the same normalized origin and preserves others", () => {
    twoDestinations();
    useSettingsStore.setState({
      websiteOriginMappings: [
        { origin: "https://a.test", destinationId: "mono" },
        { origin: "https://A.test/", destinationId: "other" },
        { origin: "https://keep.test", destinationId: "mono" },
        { origin: "https://a.test.evil", destinationId: "mono" },
      ],
    });
    state().setWebsiteOriginMapping("https://a.test", "other");
    expect(state().websiteOriginMappings).toEqual([
      { origin: "https://keep.test", destinationId: "mono" },
      { origin: "https://a.test.evil", destinationId: "mono" },
      { origin: "https://a.test", destinationId: "other" },
    ]);
  });

  it("rejects invalid origins and unknown destinations with no fallback", () => {
    twoDestinations();
    for (const origin of ["https://a.test/path", "https://*.a.test", "ftp://a.test", "a.test"]) {
      expect(code(() => state().setWebsiteOriginMapping(origin, "mono"))).toBe("invalid-origin");
    }
    expect(code(() => state().setWebsiteOriginMapping("https://a.test", "ghost"))).toBe("unknown-destination");
    expect(state().websiteOriginMappings).toEqual([]);
  });

  it("remove with destinationId only drops that pair; unparsable stored rules can still be removed by raw value", () => {
    twoDestinations();
    useSettingsStore.setState({
      websiteOriginMappings: [
        { origin: "https://a.test", destinationId: "mono" },
        { origin: "https://a.test", destinationId: "other" },
        { origin: "https://bad.test/path", destinationId: "mono" },
      ],
    });
    state().removeWebsiteOriginMapping("https://a.test", "other");
    expect(state().websiteOriginMappings.map((m) => m.destinationId)).toEqual(["mono", "mono"]);
    state().removeWebsiteOriginMapping("https://bad.test/path");
    expect(state().websiteOriginMappings).toEqual([{ origin: "https://a.test", destinationId: "mono" }]);
  });

  it("removing a connection removes its destination and mappings (no auto-select)", () => {
    const keep = state().addConnection("github", gh("keep"));
    const drop = state().addConnection("github", gh("drop"));
    state().saveDestinationProfile({ id: "x", platform: "github", connectionId: drop, owner: "o", repo: "x" });
    state().saveDestinationProfile({ id: "y", platform: "github", connectionId: keep, owner: "o", repo: "y" });
    state().setWebsiteOriginMapping("https://x.test", "x");
    state().setWebsiteOriginMapping("https://y.test", "y");
    state().selectConnection("github", drop);
    state().removeConnection("github", drop);
    expect(state().selectedConnectionIds.github).toBeUndefined();
    expect(state().destinationProfiles.map((p) => p.id)).toEqual(["y"]);
    expect(state().websiteOriginMappings).toEqual([{ origin: "https://y.test", destinationId: "y" }]);
  });
});

describe("setLinearConnectionOrganization", () => {
  it("populates a connection, refreshes the name, and refuses a different org id or a missing account", () => {
    const id = state().addConnection("linear", lin("V", "k"));
    state().setLinearConnectionOrganization(id, { id: "org-1", name: "One" });
    state().setLinearConnectionOrganization(id, { id: "org-1", name: "One Renamed" });
    expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-1", name: "One Renamed" });
    expect(code(() => state().setLinearConnectionOrganization(id, { id: "org-2", name: "Two" }))).toBe("organization-mismatch");
    expect(code(() => state().setLinearConnectionOrganization(id, { id: " ", name: "x" }))).toBe("invalid-organization");
    expect(code(() => state().setLinearConnectionOrganization("ghost", { id: "o", name: "n" }))).toBe("unknown-connection");
    expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-1", name: "One Renamed" });
  });
});

describe("putConnectionAccount (exact-id reconnect, immutable viewer ids)", () => {
  it("GitHub: same id keeps record id/defaults/last-submit even after a login rename; selected projection follows", () => {
    const a = state().addConnection("github", gh("octo", "old", 11));
    const b = state().addConnection("github", gh("other", "pat-other", 22));
    state().updateConnection("github", a, { defaults: { owner: "octo", repo: "mono" } });
    state().setConnectionLastSubmitFields("github", a, { owner: "octo", repo: "mono" });
    state().putConnectionAccount("github", a, { ...gh("octo-renamed", "new", 11), connectedAt: 99 });
    const rec = state().getConnection("github", a)!;
    expect(rec.id).toBe(a);
    expect(rec.account.auth).toMatchObject({ pat: "new", viewerLogin: "octo-renamed", viewerId: 11 });
    expect(rec.account.defaults).toEqual({ owner: "octo", repo: "mono" });
    expect(rec.lastSubmitFields).toEqual({ owner: "octo", repo: "mono" });
    expect(state().accounts.github).toBe(rec.account);
    expect(state().getConnection("github", b)?.account.auth).toMatchObject({ pat: "pat-other" });
    expect(state().selectedConnectionIds.github).toBe(a);
  });

  it("GitHub: same login but different id is rejected; the old credential survives", () => {
    const a = state().addConnection("github", gh("octo", "old", 11));
    expect(code(() => state().putConnectionAccount("github", a, gh("octo", "stolen", 99)))).toBe("account-mismatch");
    expect(state().getConnection("github", a)?.account.auth).toMatchObject({ pat: "old", viewerId: 11 });
  });

  it("GitHub: unknown id, deleted id, or a new credential without a viewer id fails and replaces nothing", () => {
    const a = state().addConnection("github", gh("octo", "old", 11));
    expect(code(() => state().putConnectionAccount("github", a, gh("octo", "no-id")))).toBe("identity-unverified");
    expect(code(() => state().putConnectionAccount("github", "ghost", gh("octo", "new", 11)))).toBe("unknown-connection");
    state().removeConnection("github", a);
    expect(code(() => state().putConnectionAccount("github", a, gh("octo", "new", 11)))).toBe("unknown-connection");
    expect(state().connections.github).toEqual([]);
    expect(state().accounts.github).toBeUndefined();
  });

  it("GitHub legacy record without a stored id: fails closed unless the provider proved the old id", () => {
    const a = state().addConnection("github", gh("octo", "old"));
    expect(code(() => state().putConnectionAccount("github", a, gh("octo", "new", 11)))).toBe("identity-unverified");
    expect(code(() => state().putConnectionAccount("github", a, gh("octo", "new", 11), { verifiedPriorViewerId: 12 }))).toBe("account-mismatch");
    expect(state().getConnection("github", a)?.account.auth).toMatchObject({ pat: "old" });
    state().putConnectionAccount("github", a, gh("renamed", "new", 11), { verifiedPriorViewerId: 11 });
    expect(state().getConnection("github", a)?.account.auth).toMatchObject({ pat: "new", viewerId: 11 });
  });

  it("GitHub: a stored id wins over a caller-supplied proof", () => {
    const a = state().addConnection("github", gh("octo", "old", 11));
    expect(code(() => state().putConnectionAccount("github", a, gh("octo", "new", 12), { verifiedPriorViewerId: 12 }))).toBe("account-mismatch");
  });

  it("GitHub: reconnect of a non-selected record does not touch the selected projection", () => {
    const a = state().addConnection("github", gh("one", "p1", 1));
    const b = state().addConnection("github", gh("two", "p2", 2));
    state().putConnectionAccount("github", b, gh("two", "p2-new", 2));
    expect(state().selectedConnectionIds.github).toBe(a);
    expect(state().accounts.github?.auth).toMatchObject({ pat: "p1" });
    expect(state().getConnection("github", b)?.account.auth).toMatchObject({ pat: "p2-new" });
  });

  it("Linear: same display name with a different id is rejected; a renamed viewer with the same id is accepted", () => {
    const id = state().addConnection("linear", lin("Alex", "k1", "u-1"), { organization: { id: "org-1", name: "One" } });
    state().updateConnection("linear", id, { defaults: { teamId: "t1" } });
    expect(code(() => state().putConnectionAccount("linear", id, lin("Alex", "k-other", "u-2"), { organization: { id: "org-1", name: "One" } }))).toBe("account-mismatch");
    state().putConnectionAccount("linear", id, lin("Alexandra", "k1-new", "u-1"), { organization: { id: "org-1", name: "One" } });
    const rec = state().getConnection("linear", id)!;
    expect(rec.account.auth).toMatchObject({ apiKey: "k1-new", viewerName: "Alexandra", viewerId: "u-1" });
    expect(rec.account.defaults).toEqual({ teamId: "t1" });
  });

  it("Linear: the same viewer id in a different workspace can never overwrite the record", () => {
    const o1 = state().addConnection("linear", lin("Same", "k1", "u-1"), { organization: { id: "org-1", name: "One" } });
    const o2 = state().addConnection("linear", lin("Same", "k2", "u-1"), { organization: { id: "org-2", name: "Two" } });
    expect(code(() => state().putConnectionAccount("linear", o1, lin("Same", "k-org2", "u-1"), { organization: { id: "org-2", name: "Two" } }))).toBe("organization-mismatch");
    expect(code(() => state().putConnectionAccount("linear", o1, lin("Same", "k-unverified", "u-1")))).toBe("organization-unverified");
    expect(state().getConnection("linear", o1)?.account.auth).toMatchObject({ apiKey: "k1" });
    state().putConnectionAccount("linear", o1, lin("Same", "k1-new", "u-1"), { organization: { id: "org-1", name: "One (renamed)" } });
    expect(state().getConnection("linear", o1)?.organization).toEqual({ id: "org-1", name: "One (renamed)" });
    expect(state().getConnection("linear", o2)?.account.auth).toMatchObject({ apiKey: "k2" });
  });

  it("Linear legacy record: needs provider proof of the old id; adopts the verified org once proven", () => {
    const id = state().addConnection("linear", lin("Same", "k"));
    const org = { organization: { id: "org-1", name: "One" } };
    expect(code(() => state().putConnectionAccount("linear", id, lin("Same", "k2", "u-1"), org))).toBe("identity-unverified");
    expect(code(() => state().putConnectionAccount("linear", id, lin("Same", "k2", "u-1"), { ...org, verifiedPriorViewerId: "u-2" }))).toBe("account-mismatch");
    expect(state().getConnection("linear", id)?.organization).toBeUndefined();
    state().putConnectionAccount("linear", id, lin("Same", "k2", "u-1"), { ...org, verifiedPriorViewerId: "u-1" });
    expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-1", name: "One" });
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "k2", viewerId: "u-1" });
  });

  it("Linear: unknown id and a credential without a viewer id fail closed", () => {
    const id = state().addConnection("linear", lin("Same", "k", "u-1"), { organization: { id: "org-1", name: "One" } });
    expect(code(() => state().putConnectionAccount("linear", "ghost", lin("Same", "k2", "u-1"), { organization: { id: "org-1", name: "One" } }))).toBe("unknown-connection");
    expect(code(() => state().putConnectionAccount("linear", id, lin("Same", "k2"), { organization: { id: "org-1", name: "One" } }))).toBe("identity-unverified");
    expect(state().getConnection("linear", id)?.account.auth).toMatchObject({ apiKey: "k" });
  });
});
