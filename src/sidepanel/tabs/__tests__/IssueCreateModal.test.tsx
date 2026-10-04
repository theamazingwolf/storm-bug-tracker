import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlatformId } from "@/types/platform";

// persist 스토어가 import 시점에 chrome.storage를 찾으므로 hoisted로 먼저 심는다.
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
    },
  };
});

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));

// 렌더 경로를 실제 store shape로 유지하고, submission side effects만 mock한다.
let settingsState: Record<string, unknown> = {};
let editorState: Record<string, unknown> = {};
let issueRows: Array<Record<string, unknown>> = [];
const getSettingsState = () => settingsState;
const getEditorState = () => editorState;
const getIssuesState = () => ({
  issues: issueRows,
  markSubmitted: vi.fn(),
  markSlackShared: vi.fn(),
  patchIssue: vi.fn(),
});
vi.mock("@/store/settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-store")>();
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (sel: (s: Record<string, unknown>) => unknown) => sel(getSettingsState()),
      { getState: () => getSettingsState() },
    ),
  };
});

vi.mock("@/store/editor-store", () => ({
  useEditorStore: (sel: (s: Record<string, unknown>) => unknown) => sel(getEditorState()),
  whenAttachmentBlobsReady: vi.fn(async () => {}),
}));

vi.mock("@/store/issues-store", () => ({
  useIssuesStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) => sel(getIssuesState()),
    { getState: () => getIssuesState() },
  ),
}));

vi.mock("@/store/settings-ui-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/settings-ui-store")>();
  return {
    ...actual,
    useSettingsUiStore: (sel: (s: Record<string, unknown>) => unknown) =>
      sel({ issueSections: [], attachmentsEnabled: false }),
  };
});

vi.mock("@/sidepanel/hooks/usePlatformFields", () => ({
  usePlatformFields: () => ({
    ghFields: {},
    setGhFields: vi.fn(),
    linearFields: {},
    setLinearFields: vi.fn(),
    notionFields: {},
    setNotionFields: vi.fn(),
    gitlabFields: {},
    setGitlabFields: vi.fn(),
    asanaFields: {},
    setAsanaFields: vi.fn(),
    clickupFields: {},
    setClickupFields: vi.fn(),
    slackFields: {},
    setSlackFields: vi.fn(),
  }),
}));

vi.mock("@/sidepanel/tabs/SubmitFieldsDialog", () => ({
  SubmitFieldsDialog: (props: {
    open: boolean;
    platform: PlatformId;
    availablePlatforms: PlatformId[];
    destinationBinding: unknown;
    onDestinationBindingChange: (binding: unknown) => void;
    onOpenChange: (open: boolean) => void;
  }) => props.open ? (
    <div
      data-testid="submit-dialog"
      data-platform={props.platform}
      data-platforms={props.availablePlatforms.join(",")}
      data-binding={JSON.stringify(props.destinationBinding)}
    >
      <button onClick={() => props.onDestinationBindingChange({
        id: "manual-profile",
        platform: "github",
        connectionId: "github-account-b",
        owner: "org-b",
        repo: "repo-b",
      })}>mock-select-binding</button>
      <button onClick={() => props.onOpenChange(false)}>mock-close</button>
    </div>
  ) : null,
}));

import { IssueCreateModal } from "../IssueCreateModal";

const githubConnection = {
  id: "github-account-b",
  platform: "github",
  account: { platform: "github", connectedAt: 1, auth: { kind: "pat", pat: "mock", viewerLogin: "viewer-b" }, defaults: {} },
};
const githubProfile = {
  id: "mapped-profile",
  platform: "github",
  connectionId: githubConnection.id,
  owner: "org-b",
  repo: "repo-b",
};
function connect(platform: PlatformId): void {
  settingsState.accounts = { [platform]: { defaults: {} } };
}

beforeEach(() => {
  settingsState = {
    accounts: {},
    lastSubmittedPlatform: undefined,
    lastSubmitFields: {},
    connections: { github: [], linear: [] },
    selectedConnectionIds: {},
    destinationProfiles: [],
    websiteOriginMappings: [],
  };
  editorState = {
    setTargetPlatform: vi.fn(),
    setDestinationBinding: (binding: unknown) => { editorState.destinationBinding = binding; },
    captureMode: "screenshot",
    draft: { title: "", sections: {} },
    issueFields: {},
    setIssueFields: vi.fn(),
    onSubmitted: vi.fn(),
    attachments: [],
    currentIssueId: null,
    destinationBinding: null,
    target: { url: "https://app.example.test/issue/1" },
  };
  issueRows = [];
});

describe("IssueCreateModal 제출 버튼", () => {
  it("연결이 0개여도 GitHub/Linear를 노출해 첫 연결로 진입할 수 있다", async () => {
    render(<IssueCreateModal />);

    const button = screen.getByTestId("issue-submit-open");
    expect(button.getAttribute("aria-disabled")).toBe("false");
    await userEvent.click(button);

    const dialog = await screen.findByTestId("submit-dialog");
    expect(dialog.getAttribute("data-platform")).toBe("github");
    expect(dialog.getAttribute("data-platforms")).toContain("github");
    expect(dialog.getAttribute("data-platforms")).toContain("linear");
  });

  it("연결된 다른 플랫폼은 기존 초기 선택을 유지한다", async () => {
    connect("jira");
    render(<IssueCreateModal />);

    const button = screen.getByTestId("issue-submit-open");
    expect(button.getAttribute("aria-disabled")).toBe("false");
    await userEvent.click(button);
    expect((await screen.findByTestId("submit-dialog")).getAttribute("data-platform")).toBe("jira");
  });

  it("manual override binding은 닫고 다시 열어도 그대로 남는다", async () => {
    settingsState.connections = { github: [githubConnection], linear: [] };
    render(<IssueCreateModal />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("issue-submit-open"));
    await screen.findByTestId("submit-dialog");
    await user.click(screen.getByText("mock-select-binding"));
    await user.click(screen.getByText("mock-close"));
    await user.click(screen.getByTestId("issue-submit-open"));

    expect((await screen.findByTestId("submit-dialog")).getAttribute("data-binding")).toContain('"connectionId":"github-account-b"');
    expect(screen.getByTestId("submit-dialog").getAttribute("data-binding")).toContain('"repo":"repo-b"');
  });

  it("기존 legacy draft는 현재 website mapping에 맞춰도 자동 바인딩하지 않는다", async () => {
    settingsState.connections = { github: [githubConnection], linear: [] };
    settingsState.destinationProfiles = [githubProfile];
    settingsState.websiteOriginMappings = [{ origin: "https://app.example.test", destinationId: githubProfile.id }];
    editorState.currentIssueId = "legacy-issue";
    issueRows = [{ id: "legacy-issue", platform: "github" }];
    render(<IssueCreateModal />);
    await userEvent.click(screen.getByTestId("issue-submit-open"));

    expect((await screen.findByTestId("submit-dialog")).getAttribute("data-binding")).toBe("null");
  });

  it("native title 툴팁을 남기지 않는다 (Radix 툴팁과 이중 노출)", () => {
    render(<IssueCreateModal />);

    expect(screen.getByTestId("issue-submit-open").hasAttribute("title")).toBe(false);
  });
});
