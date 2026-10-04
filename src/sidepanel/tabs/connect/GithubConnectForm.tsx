import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { SiGithub as Github } from "@icons-pack/react-simple-icons";
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
  GithubAccount,
  GithubMyself,
  GithubOAuthAuth,
} from "@/types/github";
import { sendBg } from "@/lib/bg-client";
import { toLocalizedError } from "@/sidepanel/lib/connection-errors";
import type { ConnectFlowProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { commitGithubAccount } from "./connectionCommit";
import { PlatformConnectFlow } from "./PlatformConnectFlow";

export function GithubConnectedBody() {
  return (
    <ConnectionsPanel
      platform="github"
      renderReconnect={(record, renderTrigger) => (
        <GithubConnectFlow
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

export function GithubConnectFlow({
  connected,
  onConnected,
  autoStart,
  onAutoStartHandled,
  connectionId,
  renderTrigger,
  triggerLabel,
}: ConnectFlowProps) {
  const t = useT();
  const existing = useSettingsStore((s) => s.connections.github.length);
  const label =
    triggerLabel ??
    (!connectionId && existing > 0
      ? t("connections.addAnother", { platform: t("platform.tab.github") })
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
      commitAccount={(account) =>
        commitGithubAccount(account, connectionId).catch((err: unknown) => {
          throw toLocalizedError(t, err);
        })
      }
      platform="github"
      icon={<Github className="h-4 w-4 dark:invert" color="default" />}
      tokenLabelKey="github.patButton"
      availableRequest={{ type: "github.oauth.available" }}
      startOAuthRequest={{ type: "github.startOAuth" }}
      buildAccount={(auth: GithubOAuthAuth): GithubAccount => ({
        platform: "github",
        connectedAt: Date.now(),
        auth,
        defaults: {},
      })}
      renderTokenDialog={({ open, onOpenChange }) => (
        <PatDialog
          open={open}
          onOpenChange={onOpenChange}
          onConnected={onConnected}
          connectionId={connectionId}
        />
      )}
    />
  );
}

function PatDialog({
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
  const [pat, setPat] = useState("");
  const [validating, setValidating] = useState(false);

  const trimmed = pat.trim();
  const canValidate = !!trimmed && !validating;

  async function handleValidate() {
    if (validating) return;
    setValidating(true);
    try {
      const me = await sendBg<GithubMyself>({
        type: "github.testPat",
        pat: trimmed,
      });
      const next: GithubAccount = {
        platform: "github",
        connectedAt: Date.now(),
        auth: {
          kind: "pat",
          pat: trimmed,
          viewerLogin: me.login,
          viewerId: me.id,
          viewerEmail: me.email,
        },
        defaults: {},
      };
      const id = await commitGithubAccount(next, connectionId);
      onConnected(id);
      setPat("");
      onOpenChange(false);
    } catch (err) {
      toast.error(toLocalizedError(t, err).message);
    } finally {
      setValidating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("github.patDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("github.patDialog.body")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FieldRow
            label={t("github.patLabel")}
            htmlFor="github-pat"
            labelAction={
              <a
                href="https://github.com/settings/tokens"
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
              id="github-pat"
              placeholder={t("github.patPlaceholder")}
              value={pat}
              onChange={(e) => setPat(e.target.value)}
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
