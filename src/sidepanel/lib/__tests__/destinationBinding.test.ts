import { describe, expect, it } from "vitest";
import type { DestinationProfile, GithubConnection, LinearConnection } from "@/types/connection";
import { cloneDestinationBinding, resolveDestinationBinding } from "../destinationBinding";

const github: DestinationProfile = {
  id: "repo-profile",
  platform: "github",
  connectionId: "gh-a",
  owner: "org",
  repo: "tracker",
};
const linear: DestinationProfile = {
  id: "team-profile",
  platform: "linear",
  connectionId: "linear-a",
  organizationId: "org-a",
  teamId: "team-a",
  teamName: "Product",
  teamKey: "PROD",
  projectId: "project-a",
  projectName: "Website",
};

const githubConnection = { id: "gh-a", platform: "github", account: {} } as GithubConnection;
const linearConnection = { id: "linear-a", platform: "linear", account: {} } as LinearConnection;

describe("destination draft binding", () => {
  it("copies provider-native destination data as an immutable draft snapshot", () => {
    const binding = cloneDestinationBinding(github);
    expect(binding).toEqual(github);
    expect(binding).not.toBe(github);
    expect(binding).not.toHaveProperty("account");
    expect(cloneDestinationBinding(linear)).toEqual({
      id: "team-profile", platform: "linear", connectionId: "linear-a",
      organizationId: "org-a", teamId: "team-a", projectId: "project-a",
    });
  });

  it("resolves only the stored connection ID and never substitutes another connection", () => {
    const result = resolveDestinationBinding(github, {
      github: [
        { ...githubConnection, id: "gh-b" },
        githubConnection,
      ],
      linear: [linearConnection],
    });
    expect(result).toEqual({ ok: true, binding: github, connection: githubConnection });
  });

  it("blocks a removed connection while preserving the captured destination", () => {
    const result = resolveDestinationBinding(github, {
      github: [{ ...githubConnection, id: "gh-b" }],
      linear: [linearConnection],
    });
    expect(result).toEqual({ ok: false, reason: "missing-connection", binding: github });
  });

  it("supports Linear organization, team, and project snapshots", () => {
    expect(resolveDestinationBinding(linear, {
      github: [],
      linear: [linearConnection],
    })).toEqual({
      ok: true,
      binding: {
        id: "team-profile", platform: "linear", connectionId: "linear-a",
        organizationId: "org-a", teamId: "team-a", projectId: "project-a",
      },
      connection: linearConnection,
    });
  });
});
