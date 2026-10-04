import { useState } from "react";
import { useT } from "@/i18n";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Section } from "@/sidepanel/components/Section";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { useNativeChatGptUiStore } from "@/store/native-chatgpt-ui-store";
import { nativeChatGptBridge } from "@/sidepanel/lib/nativeChatGptBridge";
import {
  nativeChatGptListModels,
  nativeChatGptSelectProfile,
  nativeChatGptSignIn,
  nativeChatGptSignOut,
  refreshNativeChatGptSnapshot,
} from "@/sidepanel/lib/nativeChatGptClient";
import { NativeChatGptError, NativeHostUnavailableError } from "@/sidepanel/lib/nativeChatGptProtocol";

type SubscriptionErrorKey =
  | "llm.subscription.hostUnavailable"
  | "llm.subscription.errorBusy"
  | "llm.subscription.errorAuth"
  | "llm.subscription.errorPlan"
  | "llm.subscription.errorModel"
  | "llm.subscription.errorQuota"
  | "llm.subscription.errorGeneric";

function errorMessageKey(error: unknown): SubscriptionErrorKey {
  if (error instanceof NativeHostUnavailableError) return "llm.subscription.hostUnavailable";
  if (!(error instanceof NativeChatGptError)) return "llm.subscription.errorGeneric";
  const code = error.code.toLowerCase();
  if (/busy|timeout/.test(code)) return "llm.subscription.errorBusy";
  if (/usage_limit|quota|rate_limit/.test(code)) return "llm.subscription.errorQuota";
  if (/auth|sign_in|profile.*not_signed_in/.test(code)) return "llm.subscription.errorAuth";
  if (/plan_scope|scope|permission/.test(code)) return "llm.subscription.errorPlan";
  if (/model/.test(code)) return "llm.subscription.errorModel";
  return "llm.subscription.errorGeneric";
}

export function NativeSubscriptionSettings() {
  const t = useT();
  const profileId = useSettingsUiStore((state) => state.subscriptionProfileId);
  const modelId = useSettingsUiStore((state) => state.subscriptionModelId);
  const setProfileId = useSettingsUiStore((state) => state.setSubscriptionProfileId);
  const setModelId = useSettingsUiStore((state) => state.setSubscriptionModelId);
  const status = useNativeChatGptUiStore((state) => state.status);
  const transportConnected = useNativeChatGptUiStore((state) => state.transportConnected);
  const hasCheckedHelper = useNativeChatGptUiStore((state) => state.hasCheckedHelper);
  const profiles = useNativeChatGptUiStore((state) => state.profiles);
  const models = useNativeChatGptUiStore((state) => state.models);
  const modelsProfileId = useNativeChatGptUiStore((state) => state.modelsProfileId);
  const setSnapshot = useNativeChatGptUiStore((state) => state.setSnapshot);
  const setModels = useNativeChatGptUiStore((state) => state.setModels);
  const clearModels = useNativeChatGptUiStore((state) => state.clearModels);
  const clearProfile = useNativeChatGptUiStore((state) => state.clearProfile);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<SubscriptionErrorKey | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const helperAvailable = Boolean(status?.connected && nativeChatGptBridge.connected);
  const modelListLoaded = modelsProfileId === profileId;
  const selectedModelValid = Boolean(
    profileId && modelListLoaded && models.some((model) => model.slug === modelId),
  );
  const extensionId = typeof chrome !== "undefined" ? chrome.runtime.id : "";

  const run = async (operation: string, action: () => Promise<void>) => {
    setBusy(operation);
    setErrorKey(null);
    try {
      await action();
    } catch (error) {
      setErrorKey(errorMessageKey(error));
    } finally {
      setBusy(null);
    }
  };

  const refresh = () => run("refresh", async () => {
    const snapshot = await refreshNativeChatGptSnapshot();
    setSnapshot(snapshot.status, snapshot.profiles);
    const saved = snapshot.profiles.find((profile) => profile.id === profileId);
    if (!saved || !saved.signedIn || !saved.planEnabled) setModelId("");
  });

  const signIn = () => run("sign-in", async () => {
    if (!helperAvailable) throw new NativeHostUnavailableError();
    // Never send a stale/unknown opaque ID: the helper must not interpret it as new registration.
    const knownProfile = profiles.find((profile) => profile.id === profileId);
    const result = await nativeChatGptSignIn(knownProfile?.id);
    setProfileId(result.profileId);
    clearModels();
    const snapshot = await refreshNativeChatGptSnapshot();
    setSnapshot(snapshot.status, snapshot.profiles);
  });

  const selectProfile = (nextProfileId: string) => run("profile", async () => {
    const selected = profiles.find((profile) => profile.id === nextProfileId);
    if (!selected) throw new NativeChatGptError("profile_invalid");
    await nativeChatGptSelectProfile(nextProfileId);
    setProfileId(nextProfileId);
    clearModels();
  });

  const listModels = () => run("models", async () => {
    if (!profileId || !selectedProfile?.signedIn || !selectedProfile.planEnabled) {
      throw new NativeChatGptError("profile_not_ready");
    }
    const nextModels = await nativeChatGptListModels(profileId);
    setModels(profileId, nextModels);
    if (!nextModels.some((model) => model.slug === modelId)) setModelId("");
  });

  const signOut = () => run("sign-out", async () => {
    if (!profileId || !selectedProfile) throw new NativeChatGptError("profile_invalid");
    await nativeChatGptSignOut(profileId);
    clearProfile(profileId);
    setProfileId(null);
  });

  return (
    <Section title={t("llm.subscription.title")}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("llm.subscription.description")}</p>

        <Card>
          <CardContent className="space-y-3 px-4 py-3">
            <StatusRow label={t("llm.subscription.transport")} value={
              !hasCheckedHelper && !transportConnected ? t("llm.subscription.notChecked") : helperAvailable
                ? t("llm.subscription.connected") : t("llm.subscription.disconnected")
            } />
            <StatusRow label={t("llm.subscription.profile")} value={
              !selectedProfile ? t("llm.subscription.noProfile") : selectedProfile.signedIn
                ? t("llm.subscription.signedIn", { email: selectedProfile.email })
                : t("llm.subscription.signedOut", { email: selectedProfile.email })
            } />
            <StatusRow label={t("llm.subscription.plan")} value={
              selectedProfile?.planEnabled ? t("llm.subscription.planEnabled") : t("llm.subscription.planDisabled")
            } />
            <StatusRow label={t("llm.subscription.modelStatus")} value={
              selectedModelValid ? t("llm.subscription.modelValid", { model: modelId })
                : t("llm.subscription.modelInvalid")
            } />
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busy !== null}>
            {busy === "refresh" ? t("llm.subscription.working") : t("llm.subscription.checkHelper")}
          </Button>
          <Button type="button" onClick={() => void signIn()} disabled={busy !== null || !helperAvailable}>
            {busy === "sign-in" ? t("llm.subscription.working") : selectedProfile?.signedIn
              ? t("llm.subscription.reconnect") : t("llm.subscription.signIn")}
          </Button>
        </div>

        {profiles.length > 0 && (
          <label className="block space-y-2 text-sm font-medium">
            <span>{t("llm.subscription.profileSelect")}</span>
            <Select
              value={profileId ?? ""}
              onValueChange={(next) => void selectProfile(next)}
              disabled={busy !== null}
            >
              <SelectTrigger className="w-full" aria-label={t("llm.subscription.profileSelect")}>
                <SelectValue placeholder={t("llm.subscription.profilePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.email} {!profile.signedIn ? `· ${t("llm.subscription.signedOutShort")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        {profileId && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void listModels()}
                disabled={busy !== null || !helperAvailable || !selectedProfile?.signedIn || !selectedProfile.planEnabled}
              >
                {busy === "models" ? t("llm.subscription.working") : t("llm.subscription.loadModels")}
              </Button>
              {selectedProfile && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={busy !== null}>
                      {t("llm.subscription.signOut")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("llm.subscription.signOutConfirm.title")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("llm.subscription.signOutConfirm.body")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("common.close")}</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void signOut()}>
                        {t("llm.subscription.signOut")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
            {modelListLoaded && (
              <Select
                value={selectedModelValid ? modelId : ""}
                onValueChange={setModelId}
                disabled={busy !== null || models.length === 0}
              >
                <SelectTrigger className="w-full" aria-label={t("llm.subscription.modelSelect")}>
                  <SelectValue placeholder={t("llm.subscription.modelPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.slug} value={model.slug}>{model.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {errorKey && <p role="alert" className="text-sm text-destructive">{t(errorKey)}</p>}
        <p className="text-sm text-muted-foreground">{t("llm.subscription.textOnly")}</p>

        <div className="rounded-md border border-border bg-muted/50 p-3 text-sm">
          <p className="font-medium">{t("llm.subscription.setupTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("llm.subscription.setupBody")}</p>
          <p className="mt-2 break-all"><code>{extensionId || "<extension-id>"}</code></p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-xs">
            {`cd ~/repos/storm-tracker/native/chatgpt-host\nnpm ci\nnode install.js --browser chrome --extension-id ${extensionId || "<extension-id>"}`}
          </pre>
          <p className="mt-2 text-muted-foreground">{t("llm.subscription.setupRefresh")}</p>
        </div>
      </div>
    </Section>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
