import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: unknown;
vi.stubGlobal("chrome", {
  storage: { local: {
    get: async (key: string) => ({ [key]: stored }),
    set: async (values: Record<string, unknown>) => { stored = values["bugshot-settings"]; },
  } },
});

import {
  resolveStoredGithubConnectionAuth,
  resolveStoredLinearConnectionAuth,
} from "../settings-storage";

const envelope = (state: unknown) => ({ state, version: 13 });
const github = (login: string, token: string) => ({ platform: "github", connectedAt: 1, auth: { kind: "pat", pat: token, viewerLogin: login }, defaults: {} });
const linear = (viewerName: string, token: string) => ({ platform: "linear", connectedAt: 1, auth: { kind: "apiKey", apiKey: token, viewerName }, defaults: {} });

beforeEach(() => { stored = undefined; });

describe("connection-scoped auth resolution", () => {
  it("keeps legacy singleton reads compatible and assigns the stable migration ID", async () => {
    stored = envelope({ accounts: { github: github("octo", "pat-1") } });
    await expect(resolveStoredGithubConnectionAuth()).resolves.toEqual({
      status: "resolved", connectionId: "legacy-github", auth: github("octo", "pat-1").auth,
    });
  });

  it("rejects a no-ID request when multiple GitHub connections exist, even with a selected pointer", async () => {
    stored = envelope({
      accounts: { github: github("selected", "pat-selected") },
      connections: { github: [
        { id: "gh-1", platform: "github", account: github("selected", "pat-selected") },
        { id: "gh-2", platform: "github", account: github("other", "pat-other") },
      ] },
      selectedConnectionIds: { github: "gh-1" },
    });
    await expect(resolveStoredGithubConnectionAuth()).resolves.toEqual({ status: "ambiguous" });
  });

  it("does not fall back from an unknown explicit ID to the selected account", async () => {
    stored = envelope({
      accounts: { github: github("selected", "pat-selected") },
      connections: { github: [{ id: "gh-1", platform: "github", account: github("selected", "pat-selected") }] },
      selectedConnectionIds: { github: "gh-1" },
    });
    await expect(resolveStoredGithubConnectionAuth("removed-id")).resolves.toEqual({ status: "unknown" });
  });

  it("selects the requested Linear organization connection despite identical viewer names", async () => {
    const sharedAuth = linear("Same Viewer", "api-key").auth;
    stored = envelope({
      connections: { linear: [
        { id: "lin-1", platform: "linear", organization: { id: "org-1", name: "Org 1" }, account: { ...linear("Same Viewer", "key1"), auth: sharedAuth } },
        { id: "lin-2", platform: "linear", organization: { id: "org-2", name: "Org 2" }, account: { ...linear("Same Viewer", "key2"), auth: sharedAuth } },
      ] },
      selectedConnectionIds: { linear: "lin-1" },
    });
    await expect(resolveStoredLinearConnectionAuth("lin-2")).resolves.toEqual({
      status: "resolved", connectionId: "lin-2", auth: sharedAuth, organization: { id: "org-2", name: "Org 2" },
    });
  });
});
