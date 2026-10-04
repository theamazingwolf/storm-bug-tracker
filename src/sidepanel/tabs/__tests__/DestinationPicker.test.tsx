import { useState, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DestinationProfile } from "@/types/connection";

vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});
vi.mock("@/i18n", () => ({ useT: () => (key: string) => key }));
const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (req: unknown) => sendBg(req) }));
vi.mock("../connect/GithubConnectForm", () => ({
  GithubConnectFlow: ({ renderTrigger }: { renderTrigger: (props: { onClick: () => void; connecting: boolean; disabled: boolean }) => ReactNode }) => renderTrigger({ onClick: () => {}, connecting: false, disabled: false }),
}));
vi.mock("../connect/LinearConnectForm", () => ({
  LinearConnectFlow: ({ renderTrigger }: { renderTrigger: (props: { onClick: () => void; connecting: boolean; disabled: boolean }) => ReactNode }) => renderTrigger({ onClick: () => {}, connecting: false, disabled: false }),
}));
vi.mock("../destinations/ConnectionPickers", () => ({
  ConnectionTeamCombobox: ({ connectionId, onChange }: { connectionId: string; onChange: (team: { teamId: string; teamName: string; teamKey: string }) => void }) => (
    <button data-testid="choose-team" data-connection={connectionId} onClick={() => onChange({ teamId: "team-1", teamName: "Team One", teamKey: "ONE" })}>choose team</button>
  ),
  ConnectionProjectCombobox: ({ connectionId, teamId, onChange }: { connectionId: string; teamId?: string; onChange: (id: string | null, name?: string) => void }) => (
    <button data-testid="choose-project" data-connection={connectionId} data-team={teamId} onClick={() => onChange("project-1", "Project One")}>choose project</button>
  ),
}));

import { useSettingsStore } from "@/store/settings-store";
import { DestinationPicker } from "../DestinationPicker";

const connection = {
  id: "gh-account-b",
  platform: "github" as const,
  account: { platform: "github" as const, connectedAt: 1, auth: { kind: "pat" as const, pat: "mock", viewerLogin: "viewer-b" }, defaults: {} },
};
const repo = {
  id: 1, nodeId: "node-1", owner: "org-b", name: "repo-b", fullName: "org-b/repo-b",
  private: false, htmlUrl: "", hasIssues: true, archived: false,
};
const alternateConnection = {
  ...connection,
  id: "gh-account-a",
  account: { ...connection.account, auth: { ...connection.account.auth, pat: "other", viewerLogin: "viewer-a" } },
};
const linearConnection = {
  id: "linear-account-c",
  platform: "linear" as const,
  account: { platform: "linear" as const, connectedAt: 1, auth: { kind: "apiKey" as const, apiKey: "mock", viewerName: "viewer-c", viewerEmail: "viewer@example.test" }, defaults: {} },
  organization: { id: "org-c", name: "Org C" },
};

function Harness({ initialValue = null }: { initialValue?: DestinationProfile | null }) {
  const [value, setValue] = useState<DestinationProfile | null>(initialValue);
  return <DestinationPicker platform="github" origin="https://app.example.test/path" value={value} onChange={setValue} />;
}
function LinearHarness() {
  const [value, setValue] = useState<DestinationProfile | null>(null);
  return <DestinationPicker platform="linear" origin="https://app.example.test/path" value={value} onChange={setValue} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendBg.mockResolvedValue([repo]);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
  useSettingsStore.setState({
    accounts: {},
    connections: { github: [connection], linear: [] },
    selectedConnectionIds: {},
    destinationProfiles: [],
    websiteOriginMappings: [],
  });
});

describe("DestinationPicker", () => {
  it("creates a destination for an existing connection even when that account is not selected globally", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<DestinationProfile | null>(null);
      return <DestinationPicker platform="github" origin="https://app.example.test/path" value={value} onChange={(next) => { onChange(next); setValue(next); }} />;
    }
    render(<Controlled />);

    await user.selectOptions(screen.getByRole("combobox", { name: "destinations.field.connection" }), connection.id);
    await user.click(screen.getByRole("combobox", { name: "github.section.repo" }));
    await waitFor(() => expect(sendBg).toHaveBeenCalledWith({ type: "github.searchRepos", query: "", connectionId: connection.id }));
    await user.click(await screen.findByText("org-b/repo-b"));
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(useSettingsStore.getState().destinationProfiles).toEqual([expect.objectContaining({
      platform: "github", connectionId: connection.id, owner: "org-b", repo: "repo-b",
    })]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ connectionId: connection.id, owner: "org-b", repo: "repo-b" }));
    await user.click(screen.getByRole("button", { name: "destination.remember" }));
    expect(useSettingsStore.getState().websiteOriginMappings).toEqual([
      { origin: "https://app.example.test", destinationId: useSettingsStore.getState().destinationProfiles[0].id },
    ]);
  });

  it("creates a Linear destination for an existing unselected connection", async () => {
    useSettingsStore.setState({ connections: { github: [], linear: [linearConnection] } });
    const user = userEvent.setup();
    render(<LinearHarness />);

    await user.selectOptions(screen.getByRole("combobox", { name: "destinations.field.connection" }), linearConnection.id);
    const team = screen.getByTestId("choose-team");
    expect(team.getAttribute("data-connection")).toBe(linearConnection.id);
    await user.click(team);
    const project = screen.getByTestId("choose-project");
    expect(project.getAttribute("data-connection")).toBe(linearConnection.id);
    expect(project.getAttribute("data-team")).toBe("team-1");
    await user.click(project);
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(useSettingsStore.getState().destinationProfiles).toEqual([expect.objectContaining({
      platform: "linear", connectionId: linearConnection.id, organizationId: "org-c",
      teamId: "team-1", projectId: "project-1",
    })]);
  });

  it("keeps a bound target snapshot separate from a saved profile edited under the same ID", async () => {
    const profile: DestinationProfile = {
      id: "same-id", platform: "github", connectionId: connection.id, owner: "org-b", repo: "edited-repo",
    };
    const snapshot: DestinationProfile = {
      ...profile, owner: "org-a", repo: "original-repo",
    };
    useSettingsStore.setState({ destinationProfiles: [profile] });
    const user = userEvent.setup();
    render(<Harness initialValue={snapshot} />);

    const picker = screen.getByRole("combobox", { name: "destination.label" }) as HTMLSelectElement;
    expect(picker.value).toBe("snapshot:same-id");
    expect(Array.from(picker.options).map((option) => option.value)).toContain("saved:same-id");
    expect(Array.from(picker.options).map((option) => option.value)).toContain("snapshot:same-id");
    expect(screen.getByRole("option", { name: /original-repo/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /edited-repo/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "destination.remember" })).toBeNull();

    await user.selectOptions(picker, "saved:same-id");
    expect(picker.value).toBe("saved:same-id");
  });

  it("shows a missing-connection state instead of projecting another account onto a removed binding", () => {
    useSettingsStore.setState({
      accounts: { github: alternateConnection.account },
      connections: { github: [alternateConnection], linear: [] },
      selectedConnectionIds: { github: alternateConnection.id },
    });
    render(<Harness initialValue={{ id: "removed", platform: "github", connectionId: connection.id, owner: "org-b", repo: "repo-b" }} />);

    expect(screen.getByRole("alert").textContent).toContain("destination.connectionMissing");
    expect((screen.getByRole("combobox", { name: "destination.label" }) as HTMLSelectElement).value).toBe("snapshot:removed");
  });
});
