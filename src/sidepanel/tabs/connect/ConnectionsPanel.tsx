import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { ConnectedBadge } from "@/sidepanel/components/ConnectedBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSettingsStore } from "@/store/settings-store";
import type { GithubConnection, LinearConnection } from "@/types/connection";
import { trackDisconnect } from "@/sidepanel/lib/track-submit";
import { connectionErrorMessage } from "@/sidepanel/lib/connection-errors";
import { connectionLabel } from "@/sidepanel/lib/connection-labels";
import type { TriggerProps } from "@/sidepanel/tabs/integrationsTabUtils";
import { verifyLinearOrganization } from "./connectionCommit";
import { GithubConnectionDefaults, LinearConnectionDefaults } from "./ConnectionDefaults";

type AnyConnection = GithubConnection | LinearConnection;

interface Props {
  platform: "github" | "linear";
  /** Renders the platform's connect flow bound to exactly this record (reconnect). */
  renderReconnect: (record: AnyConnection, renderTrigger: (props: TriggerProps) => ReactNode) => ReactNode;
}

/** All stored accounts of one platform with explicit select / reconnect / remove per record. */
export function ConnectionsPanel({ platform, renderReconnect }: Props) {
  const t = useT();
  const records = useSettingsStore((s) => s.connections[platform]) as AnyConnection[];
  const selectedId = useSettingsStore((s) => s.selectedConnectionIds[platform]);
  const selectConnection = useSettingsStore((s) => s.selectConnection);
  const platformLabel = t(platform === "github" ? "platform.tab.github" : "platform.tab.linear");

  if (records.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid={`connections-${platform}`}>
      {!selectedId && (
        <p role="status" className="text-sm text-destructive">
          {t("connections.noneSelected", { platform: platformLabel })}
        </p>
      )}
      <ul className="flex flex-col gap-2" aria-label={t("connections.list.aria", { platform: platformLabel })}>
        {records.map((record) => (
          <ConnectionRow
            key={record.id}
            record={record}
            selected={record.id === selectedId}
            onSelect={() => selectConnection(platform, record.id)}
            reconnect={renderReconnect(record, (props) => <ReconnectTrigger record={record} {...props} />)}
          />
        ))}
      </ul>
    </div>
  );
}

function ReconnectTrigger({ record, onClick, connecting, disabled }: TriggerProps & { record: AnyConnection }) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={connecting}
      aria-label={t("connections.reconnect.aria", { name: connectionLabel(record) })}
      title={t("connections.reconnect")}
    >
      {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ConnectionRow({
  record,
  selected,
  onSelect,
  reconnect,
}: {
  record: AnyConnection;
  selected: boolean;
  onSelect: () => void;
  reconnect: ReactNode;
}) {
  const t = useT();
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const removeConnection = useSettingsStore((s) => s.removeConnection);
  const profiles = useSettingsStore((s) => s.destinationProfiles);
  const mappings = useSettingsStore((s) => s.websiteOriginMappings);
  const destinations = profiles.filter((p) => p.platform === record.platform && p.connectionId === record.id);
  const destinationIds = new Set(destinations.map((p) => p.id));
  const originCount = mappings.filter((m) => destinationIds.has(m.destinationId)).length;
  const name = connectionLabel(record);
  const auth = record.account.auth;
  const kindLabel =
    record.platform === "github"
      ? t(auth.kind === "oauth" ? "github.auth.kind.oauth" : "github.auth.kind.pat")
      : t(auth.kind === "oauth" ? "linear.auth.kind.oauth" : "linear.auth.kind.apiKey");
  const subtitle = auth.viewerEmail || (record.platform === "github" ? "github.com" : "linear.app");

  async function verify() {
    if (verifying) return;
    setVerifying(true);
    try {
      await verifyLinearOrganization(record.id);
    } catch (err) {
      toast.error(connectionErrorMessage(t, err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <li data-testid={`connection-${record.id}`}>
      <Card>
        <CardContent className="flex flex-col gap-3 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-base font-medium text-foreground">
                {record.platform === "github" ? record.account.auth.viewerLogin : record.account.auth.viewerName}
              </span>
              <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
              {record.platform === "linear" &&
                (record.organization ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {t("connections.workspace", { name: record.organization.name, id: record.organization.id })}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t("connections.workspace.unverified")}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      aria-disabled={verifying}
                      onClick={() => void verify()}
                    >
                      {verifying && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {t("connections.workspace.verify")}
                    </Button>
                  </span>
                ))}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <ConnectedBadge>{kindLabel}</ConnectedBadge>
              {selected && <Badge variant="secondary">{t("connections.selected")}</Badge>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selected ? "default" : "outline"}
              size="sm"
              aria-pressed={selected}
              aria-label={t("connections.select.aria", { name })}
              onClick={onSelect}
            >
              {t(selected ? "connections.selected" : "connections.select")}
            </Button>
            {reconnect}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 hover:text-destructive"
              aria-label={t("connections.remove.aria", { name })}
              onClick={() => setRemoveOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto gap-1"
              aria-expanded={defaultsOpen}
              onClick={() => setDefaultsOpen((v) => !v)}
            >
              {t("connections.defaults")}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${defaultsOpen ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {defaultsOpen &&
            (record.platform === "github" ? (
              <GithubConnectionDefaults record={record} />
            ) : (
              <LinearConnectionDefaults record={record} />
            ))}
        </CardContent>
      </Card>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("connections.remove.title", { name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("connections.remove.body", { destinations: destinations.length, origins: originCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                trackDisconnect(record.platform);
                removeConnection(record.platform, record.id);
              }}
            >
              {t("connections.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
