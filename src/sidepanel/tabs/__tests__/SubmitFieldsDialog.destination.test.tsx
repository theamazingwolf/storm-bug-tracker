import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/store/settings-store";
import type { GithubConnection, GithubDestinationProfile, LinearConnection, LinearDestinationProfile } from "@/types/connection";
import type { SubmitFieldsDialogProps } from "../SubmitFieldsDialog";

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@/store/editor-store", () => ({
  useEditorStore: Object.assign(() => ({}), { getState: () => ({}) }),
}));
vi.mock("../githubFields/GithubIssueFields", () => ({
  GithubIssueFields: ({ connectionId }: { connectionId?: string }) => <div data-testid="github-fields-connection">{connectionId}</div>,
}));
vi.mock("../linearFields/LinearIssueFields", () => ({
  LinearIssueFields: ({ connectionId }: { connectionId?: string }) => <div data-testid="linear-fields-connection">{connectionId}</div>,
}));

import { SubmitFieldsDialog } from "../SubmitFieldsDialog";

const connection: GithubConnection = {
  id: "github-bound",
  platform: "github",
  account: { platform: "github", connectedAt: 1, auth: { kind: "pat", pat: "mock", viewerLogin: "viewer" }, defaults: {} },
};
const binding: GithubDestinationProfile = {
  id: "profile-bound", platform: "github", connectionId: connection.id, owner: "org", repo: "repo",
};
const linearConnection: LinearConnection = {
  id: "linear-bound", platform: "linear",
  account: { platform: "linear", connectedAt: 1, auth: { kind: "apiKey", apiKey: "mock", viewerName: "viewer", viewerEmail: "viewer@example.test" }, defaults: {} },
  organization: { id: "org-linear", name: "Linear Org" },
};
const linearBinding: LinearDestinationProfile = {
  id: "linear-profile", platform: "linear", connectionId: linearConnection.id,
  organizationId: "org-linear", teamId: "team-linear", projectId: "project-linear",
};

function renderDialog(overrides: Partial<SubmitFieldsDialogProps> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    platform: "github" as const,
    setPlatform: vi.fn(),
    captureMode: "screenshot" as const,
    availablePlatforms: ["github", "linear"] as const,
    jiraFields: {}, setJiraFields: vi.fn(),
    ghFields: { owner: "org", repo: "repo" }, setGhFields: vi.fn(),
    linearFields: {}, setLinearFields: vi.fn(),
    notionFields: {}, setNotionFields: vi.fn(),
    gitlabFields: {}, setGitlabFields: vi.fn(),
    asanaFields: {}, setAsanaFields: vi.fn(),
    clickupFields: {}, setClickupFields: vi.fn(),
    slackFields: {}, setSlackFields: vi.fn(),
    onNotionSchemaResolved: vi.fn(),
    destinationBinding: binding,
    onDestinationBindingChange: vi.fn(),
    websiteOrigin: "https://app.example.test",
    onSubmit: vi.fn(async () => ({ platform: "github", issueKey: "#1", issueUrl: "https://github.com/org/repo/issues/1" })),
    ...overrides,
  } as SubmitFieldsDialogProps;
  return render(<SubmitFieldsDialog {...props} />);
}

beforeEach(() => {
  useSettingsStore.setState({
    accounts: {},
    connections: { github: [connection], linear: [] },
    selectedConnectionIds: {},
    destinationProfiles: [],
    websiteOriginMappings: [],
    lastSubmitFields: {},
  });
});

describe("SubmitFieldsDialog destination readiness", () => {
  it("renders GitHub and Linear tabs on first use with no connection records", async () => {
    useSettingsStore.setState({ connections: { github: [], linear: [] } });
    const user = userEvent.setup();
    renderDialog({ destinationBinding: null });

    expect(screen.getByTestId("platform-tab-github")).toBeTruthy();
    expect(screen.getByTestId("platform-tab-linear")).toBeTruthy();
    await user.click(screen.getByTestId("platform-tab-linear"));
    expect(screen.getByRole("combobox", { name: "destination.label" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "destinations.field.connection" })).toBeTruthy();
  });

  it("uses the draft's bound account even when another account is not globally selected", () => {
    renderDialog();
    expect((screen.getByTestId("submit-issue-confirm") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("github-fields-connection").textContent).toBe(connection.id);
  });

  it("uses the Linear binding's exact connection and team even when no account projection is selected", () => {
    useSettingsStore.setState({ connections: { github: [], linear: [linearConnection] } });
    renderDialog({
      platform: "linear",
      destinationBinding: linearBinding,
      linearFields: { teamId: "team-linear", projectId: "project-linear" },
    });
    expect((screen.getByTestId("submit-issue-confirm") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("linear-fields-connection").textContent).toBe(linearConnection.id);
  });

  it("blocks submit when the exact bound connection has been removed", () => {
    useSettingsStore.setState({ connections: { github: [], linear: [] } });
    renderDialog();
    expect((screen.getByTestId("submit-issue-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("destination.connectionMissing");
  });

  it("does not use a selected global account to ready a legacy draft without an explicit binding", () => {
    useSettingsStore.setState({
      accounts: { github: connection.account },
      selectedConnectionIds: { github: connection.id },
    });
    renderDialog({ destinationBinding: null });
    expect((screen.getByTestId("submit-issue-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks when destination fields no longer match the immutable target snapshot", () => {
    renderDialog({ ghFields: { owner: "org", repo: "different-repo" } });
    expect((screen.getByTestId("submit-issue-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});
