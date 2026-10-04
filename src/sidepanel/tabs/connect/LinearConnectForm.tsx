import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiLinear } from "@icons-pack/react-simple-icons";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/store/settings-store";
import type {
  LinearAccount,
  LinearMyself,
  LinearOAuthAuth,
} from "@/types/linear";
import { sendBg } from "@/lib/bg-client";
import { toLocalizedError } from "@/sidepanel/lib/connection-errors";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { commitLinearAccount } from "./connectionCommit";
import { PlatformConnectFlow } from "./PlatformConnectFlow";

export function LinearConnectedBody() {
  return (
    <ConnectionsPanel
      platform="linear"
      renderReconnect={(record, renderTrigger) => (
        <LinearConnectFlow
          connected
          connectionId={record.id}
          renderTrigger={renderTrigger}
          onConnected={() => {}}
          autoStart={false}
          onAutoStartHandled={() => {}}
        />
      )}
    />
  );
}

export function LinearConnectFlow({
  connected,
  onConnected,
  autoStart,
  onAutoStartHandled,
  connectionId,
  renderTrigger,
  triggerLabel,
}: ConnectFlowProps) {
  const t = useT();
  const existing = useSettingsStore((s) => s.connections.linear.length);
  const label =
    triggerLabel ??
    (!connectionId && existing > 0
      ? t("connections.addAnother", { platform: t("platform.tab.linear") })
      : undefined);
  return (
    <PlatformConnectFlow
      connected={connected}
      onConnected={onConnected}
      autoStart={autoStart}
      onAutoStartHandled={onAutoStartHandled}
      renderTrigger={renderTrigger}
      triggerLabel={label}
      preservesSettings
      commitAccount={(account, signal) =>
        commitLinearAccount(account, connectionId, signal).catch((err: unknown) => {
          throw toLocalizedError(t, err);
        })
      }
      platform="linear"
      icon={<SiLinear className="h-4 w-4" color="default" />}
      tokenLabelKey="linear.apiKeyButton"
      availableRequest={{ type: "linear.oauth.available" }}
      startOAuthRequest={{ type: "linear.startOAuth" }}
      buildAccount={(auth: LinearOAuthAuth): LinearAccount => ({
        platform: "linear",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      })}
      renderTokenDialog={({ open, onOpenChange }) => (
        <ApiKeyDialog
          open={open}
          onOpenChange={onOpenChange}
          onConnected={onConnected}
          connectionId={connectionId}
        />
      )}
    />
  );
}

function ApiKeyDialog({
  open,
  onOpenChange,
  onConnected,
  connectionId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: (connectionId?: string) => void;
  connectionId?: string;
}) {
  const t = useT();
  const [apiKey, setApiKey] = useState("");
  const [validating, setValidating] = useState(false);
  // 검증 중 다이얼로그를 닫거나 언마운트하면 늦게 끝난 응답이 계정을 저장하지 못하게 한다.
  const attemptRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (open) return;
    attemptRef.current?.abort();
    setValidating(false);
  }, [open]);
  useEffect(() => () => attemptRef.current?.abort(), []);

  const trimmed = apiKey.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    if (validating) return;
    const attempt = new AbortController();
    attemptRef.current = attempt;
    setValidating(true);
    try {
      const me = await sendBg<LinearMyself>({
        type: "linear.testApiKey",
        apiKey: trimmed,
      });
      const next: LinearAccount = {
        platform: "linear",
        connectedAt: Date.now(),
        auth: {
          kind: "apiKey",
          apiKey: trimmed,
          viewerName: me.name,
          viewerId: me.id,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      const id = await commitLinearAccount(next, connectionId, attempt.signal);
      if (attempt.signal.aborted) return;
      onConnected(id);
      setApiKey("");
      onOpenChange(false);
    } catch (err) {
      if (!attempt.signal.aborted) toast.error(toLocalizedError(t, err).message);
    } finally {
      if (!attempt.signal.aborted) setValidating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("linear.apiKeyDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("linear.apiKeyDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FieldRow
            label={t("linear.apiKeyLabel")}
            htmlFor="linear-api-key"
            labelAction={
              <a
                href="https://linear.app/settings/account/security"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("platform.getToken")}
                <ExternalLink className="h-3 w-3" />
              </a>
            }
          >
            <Input
              id="linear-api-key"
              placeholder={t("linear.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </FieldRow>

        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleValidate} disabled={!canValidate && !validating} aria-disabled={validating} className="relative aria-disabled:cursor-not-allowed">
            {validating && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
              </span>
            )}
            <span className={validating ? "opacity-0" : undefined}>
              {t("common.verify")}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
