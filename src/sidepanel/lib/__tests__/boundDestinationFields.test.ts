import { describe, expect, it } from "vitest";
import type { GithubConnection, LinearConnection } from "@/types/connection";
import { githubFieldsForDestination, linearFieldsForDestination } from "../boundDestinationFields";

describe("connection-scoped destination fields", () => {
  it("uses GitHub defaults only when they belong to the bound repository", () => {
    const connection: GithubConnection = {
      id: "gh-a",
      platform: "github",
      account: {
        platform: "github",
        connectedAt: 1,
        auth: { kind: "pat", pat: "dummy", viewerLogin: "a" },
        defaults: { owner: "acme", repo: "target", label: "bug", assignee: "alice" },
      },
      lastSubmitFields: { owner: "other", repo: "repo", label: "stale", assignee: "bob", cc: ["bob"] },
    };
    expect(githubFieldsForDestination({
      id: "dest", platform: "github", connectionId: "gh-a", owner: "acme", repo: "target",
    }, connection)).toEqual({ owner: "acme", repo: "target", label: "bug", assignee: "alice", cc: undefined });
  });

  it("restores Linear extra fields only from the same connection and team", () => {
    const connection: LinearConnection = {
      id: "linear-a",
      platform: "linear",
      account: {
        platform: "linear",
        connectedAt: 1,
        auth: { kind: "apiKey", apiKey: "dummy", viewerName: "a" },
        defaults: { teamId: "team-a", teamName: "A", teamKey: "A", labelId: "label-a", labelName: "Bug", priority: 2 },
      },
      lastSubmitFields: { teamId: "team-b", assigneeId: "someone-else", assigneeName: "Other" },
    };
    expect(linearFieldsForDestination({
      id: "dest", platform: "linear", connectionId: "linear-a", organizationId: "org", teamId: "team-a",
    }, connection)).toMatchObject({
      teamId: "team-a", teamName: "A", teamKey: "A", labelId: "label-a", labelName: "Bug", priority: 2,
    });
    expect(linearFieldsForDestination({
      id: "dest", platform: "linear", connectionId: "linear-a", organizationId: "org", teamId: "team-z",
    }, connection)).toMatchObject({ teamId: "team-z" });
    expect(linearFieldsForDestination({
      id: "dest", platform: "linear", connectionId: "linear-a", organizationId: "org", teamId: "team-z",
    }, connection).assigneeId).toBeUndefined();
  });
});
