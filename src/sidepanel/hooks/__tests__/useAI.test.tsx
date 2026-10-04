import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAI } from "../useAI";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useNativeChatGptUiStore } from "@/store/native-chatgpt-ui-store";
import { NativeChatGptError } from "@/sidepanel/lib/nativeChatGptProtocol";

const original = useSettingsUiStore.getState();

afterEach(() => {
  useNativeChatGptUiStore.getState().reset();
  useSettingsUiStore.setState({
    aiProviderPreference: original.aiProviderPreference,
    subscriptionProfileId: original.subscriptionProfileId,
    subscriptionModelId: original.subscriptionModelId,
    llm: original.llm,
  });
});

describe("useAI ChatGPT subscription selection", () => {
  it("does not fall back to configured BYOK while helper/account/model are unavailable", async () => {
    useSettingsUiStore.setState({
      aiProviderPreference: "chatgpt-subscription",
      subscriptionProfileId: null,
      subscriptionModelId: "",
      llm: { baseUrl: "https://example.test/v1", apiKey: "never-used", modelId: "byok-model" },
    });
    const { result } = renderHook(() => useAI());
    expect(result.current.status).toBe("unavailable");
    expect(result.current.providerLabel).toBe("ChatGPT subscription");
    expect(result.current.capabilities.requiresSeparatedContext).toBe(true);
    await expect(result.current.generate({ prompt: "no fallback" })).rejects.toBeInstanceOf(NativeChatGptError);
  });

  it("requires the selected saved profile and discovered model before enabling drafting", () => {
    useSettingsUiStore.setState({
      aiProviderPreference: "chatgpt-subscription",
      subscriptionProfileId: "profile-pinned",
      subscriptionModelId: "model-pinned",
      llm: null,
    });
    useNativeChatGptUiStore.getState().setSnapshot({
      connected: true,
      activeProfileId: "different-active-profile",
      planEnabled: false,
      imageInput: "unsupported",
    }, [{ id: "profile-pinned", email: "user@example.test", signedIn: true, planEnabled: true }]);
    useNativeChatGptUiStore.getState().setModels("profile-pinned", [
      { slug: "model-pinned", displayName: "Pinned model" },
    ]);
    const { result } = renderHook(() => useAI());
    expect(result.current.status).toBe("available");
    expect(result.current.capabilities.supportsImages).toBe(false);
    expect(result.current.capabilities.requiresExplicitAction).toBe(true);
  });
});
