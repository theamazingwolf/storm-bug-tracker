import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    if (key === "llm.subscription.anonymousProfile") return `ChatGPT profile (${params?.id})`;
    if (key === "llm.subscription.signedIn") return `Signed in: ${params?.email}`;
    return key;
  },
}));
vi.mock("@/sidepanel/lib/nativeChatGptBridge", () => ({
  nativeChatGptBridge: { connected: true },
}));
vi.mock("@/sidepanel/lib/nativeChatGptClient", () => ({
  refreshNativeChatGptSnapshot: vi.fn(),
  nativeChatGptSignIn: vi.fn(),
  nativeChatGptSelectProfile: vi.fn(),
  nativeChatGptListModels: vi.fn(),
  nativeChatGptSignOut: vi.fn(),
}));

import { NativeSubscriptionSettings } from "../NativeSubscriptionSettings";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useNativeChatGptUiStore } from "@/store/native-chatgpt-ui-store";
import { refreshNativeChatGptSnapshot, nativeChatGptSignIn } from "@/sidepanel/lib/nativeChatGptClient";

const emptyStatus = { connected: false, activeProfileId: null, planEnabled: false, imageInput: "unsupported" as const };
const profile = { id: "profile-1", email: null, signedIn: true, planEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  useNativeChatGptUiStore.getState().reset();
  useSettingsUiStore.setState({ subscriptionProfileId: null, subscriptionModelId: "" });
});

describe("native subscription first-run settings", () => {
  it("enables explicit first sign-in after a healthy helper check with zero profiles", async () => {
    vi.mocked(refreshNativeChatGptSnapshot)
      .mockResolvedValueOnce({ status: emptyStatus, profiles: [] })
      .mockResolvedValueOnce({ status: { ...emptyStatus, connected: true, activeProfileId: profile.id, planEnabled: true }, profiles: [profile] });
    vi.mocked(nativeChatGptSignIn).mockResolvedValue({ profileId: profile.id, email: null, planEnabled: true });
    render(<NativeSubscriptionSettings />);
    const button = screen.getByRole("button", { name: "llm.subscription.signIn" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(nativeChatGptSignIn).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "llm.subscription.checkHelper" }));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.setup().click(button);
    await waitFor(() => expect(nativeChatGptSignIn).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.getByText("Signed in: ChatGPT profile (profile-1)")).toBeTruthy());
    expect(screen.queryByText(/Signed in: null/)).toBeNull();
  });

  it("keeps a healthy saved profile usable when the helper has no active default", () => {
    useSettingsUiStore.setState({ subscriptionProfileId: profile.id });
    useNativeChatGptUiStore.getState().setSnapshot(emptyStatus, [profile]);
    render(<NativeSubscriptionSettings />);
    expect((screen.getByRole("button", { name: "llm.subscription.loadModels" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Signed in: ChatGPT profile (profile-1)")).toBeTruthy();
  });
});
