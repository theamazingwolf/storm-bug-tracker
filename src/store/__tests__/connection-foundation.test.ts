import { beforeEach, describe, expect, it } from "vitest";
import type { GithubAccount } from "@/types/github";
import type { LinearAccount } from "@/types/linear";
import { migrateToV13, useSettingsStore } from "../settings-store";

const gh = (login: string, pat = `secret-${login}`): GithubAccount => ({
  platform: "github",
  connectedAt: 10,
  auth: { kind: "pat", pat, viewerLogin: login },
  defaults: { owner: login, repo: "mono" },
});
const lin = (name: string, key: string): LinearAccount => ({
  platform: "linear",
  connectedAt: 20,
  auth: { kind: "apiKey", apiKey: `secret-${key}`, viewerName: name },
  defaults: { teamId: key, teamName: key },
});

beforeEach(() => useSettingsStore.setState({
  accounts: {}, lastSubmitFields: {}, connections: { github: [], linear: [] },
  selectedConnectionIds: {}, destinationProfiles: [], websiteOriginMappings: [],
}));

describe("connection foundation", () => {
  it("migrates the legacy singletons once without losing auth, defaults, last submit, or other providers", () => {
    const legacy = {
      accounts: { github: gh("octo"), linear: lin("Same Viewer", "ORG1"), jira: { platform: "jira" } },
      lastSubmitFields: { github: { owner: "octo", repo: "mono" }, linear: { teamId: "ORG1" } },
      titlePrefix: "[test]",
    };
    const once = migrateToV13(legacy as never);
    const twice = migrateToV13(once as never);
    expect(once.connections.github).toHaveLength(1);
    expect(once.connections.linear).toHaveLength(1);
    expect(once.connections.github[0]).toMatchObject({ id: "legacy-github", account: { auth: gh("octo").auth, defaults: gh("octo").defaults }, lastSubmitFields: legacy.lastSubmitFields.github });
    expect(once.connections.linear[0]).toMatchObject({ id: "legacy-linear", lastSubmitFields: legacy.lastSubmitFields.linear });
    expect(once.accounts.jira).toEqual(legacy.accounts.jira);
    expect(twice.connections).toEqual(once.connections);
    expect(once.selectedConnectionIds).toEqual({ github: "legacy-github", linear: "legacy-linear" });
  });

  it("keeps two same-provider connections, including same Linear viewer in distinct organizations", () => {
    const store = useSettingsStore.getState();
    const ghId = store.addConnection("github", gh("one"));
    const gh2Id = store.addConnection("github", gh("two"));
    const linId = store.addConnection("linear", lin("Same Viewer", "ORG1"), { organization: { id: "org-1", name: "Org 1" } });
    const lin2Id = store.addConnection("linear", lin("Same Viewer", "ORG2"), { organization: { id: "org-2", name: "Org 2" } });
    const state = useSettingsStore.getState();
    expect(new Set([ghId, gh2Id, linId, lin2Id]).size).toBe(4);
    expect(state.connections.github).toHaveLength(2);
    expect(state.connections.linear.map((c) => c.organization?.id)).toEqual(["org-1", "org-2"]);
    expect([ghId, gh2Id, linId, lin2Id].some((id) => id.includes("secret"))).toBe(false);
  });

  it("selects explicitly, does not surprise-fallback when selected connection is removed", () => {
    const store = useSettingsStore.getState();
    const first = store.addConnection("github", gh("first"));
    const second = store.addConnection("github", gh("second"));
    useSettingsStore.setState({
      destinationProfiles: [{ id: "dest-second", platform: "github", connectionId: second, owner: "second", repo: "mono" }],
      websiteOriginMappings: [{ origin: "https://example.test", destinationId: "dest-second" }],
    });
    store.selectConnection("github", second);
    expect(useSettingsStore.getState().accounts.github?.auth).toEqual(gh("second").auth);
    useSettingsStore.getState().removeConnection("github", second);
    const state = useSettingsStore.getState();
    expect(state.selectedConnectionIds.github).toBeUndefined();
    expect(state.accounts.github).toBeUndefined();
    expect(state.connections.github.map((c) => c.id)).toEqual([first]);
    expect(state.getConnection("github", second)).toBeUndefined();
    expect(state.destinationProfiles).toEqual([]);
    expect(state.websiteOriginMappings).toEqual([]);
  });

  it("isolates defaults and last-submit fields by connection", () => {
    const store = useSettingsStore.getState();
    const a = store.addConnection("github", gh("a"));
    const b = store.addConnection("github", gh("b"));
    store.updateConnection("github", a, { defaults: { owner: "a", repo: "one" } });
    store.updateConnection("github", b, { defaults: { owner: "b", repo: "two" } });
    store.setConnectionLastSubmitFields("github", a, { owner: "a", repo: "one" });
    store.setConnectionLastSubmitFields("github", b, { owner: "b", repo: "two" });
    const state = useSettingsStore.getState();
    expect(state.getConnection("github", a)?.account.defaults.repo).toBe("one");
    expect(state.getConnection("github", b)?.account.defaults.repo).toBe("two");
    expect(state.getConnection("github", a)?.lastSubmitFields).toEqual({ owner: "a", repo: "one" });
    expect(state.getConnection("github", b)?.lastSubmitFields).toEqual({ owner: "b", repo: "two" });
  });
});
