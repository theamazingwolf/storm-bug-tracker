import { render, screen } from "@testing-library/react";
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

const issuesHarness = vi.hoisted(() => {
  const state: { issues: Array<Record<string, any>> } = { issues: [] };
  const saveDraft = vi.fn((record: Record<string, any>) => {
    const index = state.issues.findIndex((issue) => issue.id === record.id);
    if (index >= 0) state.issues[index] = { ...state.issues[index], ...record };
    else state.issues.push(record);
  });
  const patchIssue = vi.fn((id: string, patch: Record<string, unknown>) => {
    const issue = state.issues.find((item) => item.id === id);
    if (issue) Object.assign(issue, patch);
  });
  return { state, saveDraft, patchIssue };
});
vi.mock("@/store/issues-store", () => {
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector({
      ...issuesHarness.state,
      saveDraft: issuesHarness.saveDraft,
      patchIssue: issuesHarness.patchIssue,
      markSubmitted: vi.fn(),
      markSlackShared: vi.fn(),
    }),
    { getState: () => ({
      ...issuesHarness.state,
      saveDraft: issuesHarness.saveDraft,
      patchIssue: issuesHarness.patchIssue,
      markSubmitted: vi.fn(),
      markSlackShared: vi.fn(),
    }) },
  );
  return { useIssuesStore: store };
});
vi.mock("@/store/blob-db", () => ({
  saveVideoBlob: vi.fn().mockResolvedValue(true),
  deleteVideoBlob: vi.fn().mockResolvedValue(undefined),
  saveImageBlob: vi.fn().mockResolvedValue(true),
  saveNetworkLog: vi.fn().mockResolvedValue(true),
  saveConsoleLog: vi.fn().mockResolvedValue(true),
  deleteNetworkLog: vi.fn().mockResolvedValue(undefined),
  deleteConsoleLog: vi.fn().mockResolvedValue(undefined),
  saveActionLog: vi.fn().mockResolvedValue(true),
  deleteActionLog: vi.fn().mockResolvedValue(undefined),
  dataUrlToBlob: vi.fn((value: string) => new Blob([value])),
  getNetworkLog: vi.fn().mockResolvedValue(null),
  getConsoleLog: vi.fn().mockResolvedValue(null),
  saveAttachmentBlob: vi.fn().mockResolvedValue(true),
  deleteAttachmentBlob: vi.fn().mockResolvedValue(undefined),
  deleteAttachmentBlobs: vi.fn().mockResolvedValue(undefined),
  rekeyAttachmentBlobs: vi.fn().mockResolvedValue(true),
  pruneOrphanInlineImages: vi.fn().mockResolvedValue(undefined),
  getAttachmentBlob: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/app-events", () => ({ onBlobSaveFailed: { fire: vi.fn(), listen: vi.fn() } }));
vi.mock("@/sidepanel/recorder-control", () => ({
  clearNetworkRecorder: vi.fn(), clearConsoleRecorder: vi.fn(), clearActionRecorder: vi.fn(),
}));
vi.mock("@/sidepanel/picker-clear", () => ({ clearPicker: vi.fn(), tabFrameTokens: new Map() }));
vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
  dateBcp47: () => "en-US",
}));
vi.mock("@/store/settings-ui-store", () => ({
  useSettingsUiStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ issueSections: [], attachmentsEnabled: false }),
}));
vi.mock("@/sidepanel/hooks/usePlatformFields", () => ({
  usePlatformFields: () => ({
    ghFields: {}, setGhFields: vi.fn(), linearFields: {}, setLinearFields: vi.fn(),
    notionFields: {}, setNotionFields: vi.fn(), gitlabFields: {}, setGitlabFields: vi.fn(),
    asanaFields: {}, setAsanaFields: vi.fn(), clickupFields: {}, setClickupFields: vi.fn(),
    slackFields: {}, setSlackFields: vi.fn(),
  }),
}));
vi.mock("@/sidepanel/tabs/SubmitFieldsDialog", () => ({
  SubmitFieldsDialog: (props: {
    open: boolean;
    platform: string;
    availablePlatforms: string[];
    destinationBinding: DestinationProfile | null;
  }) => props.open ? (
    <div
      data-testid="submit-dialog"
      data-platform={props.platform}
      data-platforms={props.availablePlatforms.join(",")}
      data-binding={JSON.stringify(props.destinationBinding)}
    >
      {props.platform === "github" || props.platform === "linear" ? <div data-testid="routable-destination-picker" /> : null}
    </div>
  ) : null,
}));

import { useSettingsStore } from "@/store/settings-store";
import { useEditorStore } from "@/store/editor-store";
import { IssueCreateModal } from "../IssueCreateModal";

const connection = {
  id: "github-selected-record-not-global",
  platform: "github" as const,
  account: { platform: "github" as const, connectedAt: 1, auth: { kind: "pat" as const, pat: "mock", viewerLogin: "viewer" }, defaults: {} },
};
const profile: DestinationProfile = {
  id: "mapped-profile", platform: "github", connectionId: connection.id, owner: "org", repo: "repo",
};

function beginFreshCapture() {
  useEditorStore.setState({
    captureMode: "freeform",
    phase: "drafting",
    targetPlatform: "jira",
    target: { tabId: 77, url: "https://app.example.test/issues/123", title: "App" },
    draft: { title: "Fresh bug", sections: {} },
    currentIssueId: null,
    destinationBinding: null,
    logsAttach: false,
  });
}

beforeEach(() => {
  issuesHarness.state.issues = [];
  issuesHarness.saveDraft.mockClear();
  issuesHarness.patchIssue.mockClear();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSettingsStore.setState({
    accounts: {},
    lastSubmitFields: {},
    lastSubmittedPlatform: undefined,
    connections: { github: [connection], linear: [] },
    selectedConnectionIds: {},
    destinationProfiles: [profile],
    websiteOriginMappings: [{ origin: "https://app.example.test", destinationId: profile.id }],
  });
});

describe("fresh capture confirmDraft → saved draft → submit modal", () => {
  it("saves the mapped exact-origin binding before the first modal opens", async () => {
    beginFreshCapture();
    expect(useEditorStore.getState().confirmDraft()).toBe(true);
    const saved = issuesHarness.state.issues[0];
    expect(saved).toMatchObject({
      platform: "github",
      destinationBinding: { id: profile.id, connectionId: connection.id, owner: "org", repo: "repo" },
    });
    expect(useEditorStore.getState().currentIssueId).toBe(saved.id);

    render(<IssueCreateModal />);
    await userEvent.click(screen.getByTestId("issue-submit-open"));
    const dialog = await screen.findByTestId("submit-dialog");
    expect(dialog.getAttribute("data-platform")).toBe("github");
    expect(dialog.getAttribute("data-binding")).toContain(`"connectionId":"${connection.id}"`);
    expect(screen.getByTestId("routable-destination-picker")).toBeTruthy();
  });

  it("leaves unmatched fresh captures unbound but opens the routable picker from the actual saved preview", async () => {
    useSettingsStore.setState({ websiteOriginMappings: [] });
    beginFreshCapture();
    expect(useEditorStore.getState().confirmDraft()).toBe(true);
    expect(issuesHarness.state.issues[0]).toMatchObject({ platform: "github" });
    expect(issuesHarness.state.issues[0].destinationBinding).toBeUndefined();

    render(<IssueCreateModal />);
    await userEvent.click(screen.getByTestId("issue-submit-open"));
    const dialog = await screen.findByTestId("submit-dialog");
    expect(dialog.getAttribute("data-platform")).toBe("github");
    expect(dialog.getAttribute("data-binding")).toBe("null");
    expect(screen.getByTestId("routable-destination-picker")).toBeTruthy();
  });

  it("does not retroactively bind an existing legacy draft when its page origin now has a mapping", async () => {
    issuesHarness.state.issues = [{ id: "legacy-id", status: "draft", platform: "github", title: "Legacy", pageUrl: "https://app.example.test/issues/123", draft: { title: "Legacy", sections: {} } }];
    useEditorStore.setState({
      phase: "previewing", captureMode: "freeform", targetPlatform: "github",
      target: { tabId: 77, url: "https://app.example.test/issues/123", title: "App" },
      draft: { title: "Legacy", sections: {} }, currentIssueId: "legacy-id", destinationBinding: null,
    });
    render(<IssueCreateModal />);
    await userEvent.click(screen.getByTestId("issue-submit-open"));

    const dialog = await screen.findByTestId("submit-dialog");
    expect(dialog.getAttribute("data-binding")).toBe("null");
    expect(issuesHarness.state.issues[0].destinationBinding).toBeUndefined();
  });
});
