import { useEffect, useMemo, useState } from "react";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useNativeChatGptUiStore } from "@/store/native-chatgpt-ui-store";
import {
  CHROME_AI_LANG_OPTIONS,
  createAnthropicProvider,
  createChromeAIProvider,
  createOpenAICompatibleProvider,
  detectProviderKind,
  getProviderLabel,
  type AIProvider,
  type ProviderCapabilities,
} from "@/sidepanel/lib/ai-provider";
import { NativeChatGptError } from "@/sidepanel/lib/nativeChatGptProtocol";
import {
  createNativeChatGptProvider,
  NATIVE_CHATGPT_CAPABILITIES,
} from "@/sidepanel/lib/nativeChatGptProvider";

type AIStatus = "checking" | "available" | "unavailable";
type AIPurpose = "draft" | "styling";

const unavailableSubscriptionProvider: AIProvider = {
  capabilities: NATIVE_CHATGPT_CAPABILITIES,
  generate: async () => { throw new NativeChatGptError("selection_required"); },
  createSession: async () => { throw new NativeChatGptError("selection_required"); },
};

export function useAI(purpose: AIPurpose = "draft"): {
  status: AIStatus;
  providerLabel: string | null;
  capabilities: ProviderCapabilities;
  generate: AIProvider["generate"];
  createSession: AIProvider["createSession"];
} {
  const llm = useSettingsUiStore((s) => s.llm);
  const providerPreference = useSettingsUiStore((s) => s.aiProviderPreference);
  const profileId = useSettingsUiStore((s) => s.subscriptionProfileId);
  const modelId = useSettingsUiStore((s) => s.subscriptionModelId);
  const transportConnected = useNativeChatGptUiStore((s) => s.transportConnected);
  const hasCheckedHelper = useNativeChatGptUiStore((s) => s.hasCheckedHelper);
  const profiles = useNativeChatGptUiStore((s) => s.profiles);
  const models = useNativeChatGptUiStore((s) => s.models);
  const modelsProfileId = useNativeChatGptUiStore((s) => s.modelsProfileId);
  const [chromeAIStatus, setChromeAIStatus] = useState<AIStatus>("checking");

  const subscriptionReady = Boolean(
    transportConnected &&
    hasCheckedHelper &&
    profileId &&
    profiles.some((profile) => profile.id === profileId && profile.signedIn && profile.planEnabled) &&
    modelsProfileId === profileId &&
    modelId &&
    models.some((model) => model.slug === modelId),
  );

  useEffect(() => {
    if (providerPreference === "chatgpt-subscription" || llm?.modelId) return;
    let cancelled = false;
    (async () => {
      try {
        if (!globalThis.LanguageModel) {
          setChromeAIStatus("unavailable");
          return;
        }
        const availability = await globalThis.LanguageModel.availability(
          CHROME_AI_LANG_OPTIONS,
        );
        if (!cancelled) {
          setChromeAIStatus(
            availability === "available" || availability === "readily"
              ? "available"
              : "unavailable",
          );
        }
      } catch {
        if (!cancelled) setChromeAIStatus("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [llm?.modelId, providerPreference]);

  const provider = useMemo<AIProvider>(() => {
    if (providerPreference === "chatgpt-subscription") {
      if (purpose !== "draft" || !subscriptionReady || !profileId || !modelId) {
        return unavailableSubscriptionProvider;
      }
      return createNativeChatGptProvider({ profileId, modelId });
    }
    if (llm?.modelId) {
      const kind = detectProviderKind(llm.baseUrl);
      return kind === "anthropic"
        ? createAnthropicProvider(llm)
        : createOpenAICompatibleProvider(llm);
    }
    return createChromeAIProvider();
  }, [llm, modelId, profileId, providerPreference, purpose, subscriptionReady]);

  if (providerPreference === "chatgpt-subscription") {
    return {
      status: purpose === "draft" && subscriptionReady ? "available" : "unavailable",
      providerLabel: "ChatGPT subscription",
      capabilities: provider.capabilities,
      generate: provider.generate,
      createSession: provider.createSession,
    };
  }

  return {
    status: llm?.modelId ? "available" : chromeAIStatus,
    providerLabel: llm?.modelId ? getProviderLabel(llm.baseUrl) : null,
    capabilities: provider.capabilities,
    generate: provider.generate,
    createSession: provider.createSession,
  };
}
