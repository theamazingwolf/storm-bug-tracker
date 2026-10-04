import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { useSettingsStore } from "@/store/settings-store";
import type { DestinationProfile, GithubConnection, LinearConnection, RoutablePlatform } from "@/types/connection";
import { connectionErrorMessage } from "@/sidepanel/lib/connection-errors";
import { connectionLabel } from "@/sidepanel/lib/connection-labels";
import { verifyLinearOrganization } from "@/sidepanel/tabs/connect/connectionCommit";
import { ConnectionProjectCombobox, ConnectionTeamCombobox, type TeamPick } from "./ConnectionPickers";
import { ConnectionRepoCombobox, type ConnectionRepoValue } from "./ConnectionRepoCombobox";

interface Props {
  /** Existing profile to edit; omit to create. */
  profile?: DestinationProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function newDestinationId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("Secure random IDs are unavailable");
  return `dest-${id}`;
}

function initialTeam(profile: DestinationProfile | undefined): TeamPick | null {
  if (profile?.platform !== "linear") return null;
  return { teamId: profile.teamId, teamName: profile.teamName ?? profile.teamId, teamKey: profile.teamKey ?? "" };
}

/** Mount only while open — the draft state is seeded once from `profile` and discarded on close. */
export function DestinationDialog({ profile, open, onOpenChange }: Props) {
  const t = useT();
  const githubConnections = useSettingsStore((s) => s.connections.github);
  const linearConnections = useSettingsStore((s) => s.connections.linear);
  const saveDestinationProfile = useSettingsStore((s) => s.saveDestinationProfile);

  const [platform, setPlatform] = useState<RoutablePlatform>(profile?.platform ?? "github");
  const [connectionId, setConnectionId] = useState<string | undefined>(profile?.connectionId);
  const [repo, setRepo] = useState<ConnectionRepoValue | null>(
    profile?.platform === "github" ? { owner: profile.owner, repo: profile.repo } : null,
  );
  const [team, setTeam] = useState<TeamPick | null>(initialTeam(profile));
  const [project, setProject] = useState<{ id: string; name: string } | null>(
    profile?.platform === "linear" && profile.projectId
      ? { id: profile.projectId, name: profile.projectName ?? profile.projectId }
      : null,
  );
  const [verifying, setVerifying] = useState(false);

  const records: (GithubConnection | LinearConnection)[] = platform === "github" ? githubConnections : linearConnections;
  // The selection is re-resolved from the live store on every render: a connection removed while
  // this dialog is open makes `record` undefined, which blocks Save instead of saving a ghost.
  const record = records.find((item) => item.id === connectionId);
  const linearRecord = record?.platform === "linear" ? record : undefined;
  const orgVerified = platform === "github" || !!linearRecord?.organization;
  const complete = platform === "github" ? !!repo : !!team;
  const canSave = !!record && orgVerified && complete && !verifying;

  function pickPlatform(next: RoutablePlatform) {
    if (next === platform) return;
    setPlatform(next);
    setConnectionId(undefined);
    setRepo(null);
    setTeam(null);
    setProject(null);
  }

  function pickConnection(id: string) {
    if (id === connectionId) return;
    setConnectionId(id);
    setRepo(null);
    setTeam(null);
    setProject(null);
  }

  async function verifyOrg() {
    if (!connectionId || verifying) return;
    setVerifying(true);
    try {
      await verifyLinearOrganization(connectionId);
    } catch (err) {
      toast.error(connectionErrorMessage(t, err));
    } finally {
      setVerifying(false);
    }
  }

  function save() {
    if (!record || !canSave) return;
    const id = profile?.id ?? newDestinationId();
    try {
      if (platform === "github" && repo) {
        saveDestinationProfile({ id, platform: "github", connectionId: record.id, owner: repo.owner, repo: repo.repo });
      } else if (linearRecord?.organization && team) {
        saveDestinationProfile({
          id,
          platform: "linear",
          connectionId: record.id,
          organizationId: linearRecord.organization.id,
          teamId: team.teamId,
          teamName: team.teamName,
          ...(team.teamKey ? { teamKey: team.teamKey } : {}),
          ...(project ? { projectId: project.id, projectName: project.name } : {}),
        });
      } else {
        return;
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(connectionErrorMessage(t, err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[800px] gap-5 rounded-3xl p-6 sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {t(profile ? "destinations.dialog.editTitle" : "destinations.dialog.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("destinations.dialog.body")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <FieldRow label={t("destinations.field.platform")}>
            <div role="radiogroup" aria-label={t("destinations.field.platform")} className="grid grid-cols-2 gap-2">
              {(["github", "linear"] as const).map((p) => (
                <Button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={platform === p}
                  variant={platform === p ? "default" : "outline"}
                  disabled={!!profile}
                  onClick={() => pickPlatform(p)}
                >
                  {t(p === "github" ? "platform.tab.github" : "platform.tab.linear")}
                </Button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label={t("destinations.field.connection")}>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("destinations.noConnections", { platform: t(platform === "github" ? "platform.tab.github" : "platform.tab.linear") })}
              </p>
            ) : (
              <div role="radiogroup" aria-label={t("destinations.field.connection")} className="flex flex-col gap-1.5">
                {records.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={item.id === connectionId}
                    variant={item.id === connectionId ? "default" : "outline"}
                    disabled={!!profile && item.id !== profile.connectionId}
                    className="justify-start truncate"
                    onClick={() => pickConnection(item.id)}
                  >
                    <span className="truncate">{connectionLabel(item)}</span>
                  </Button>
                ))}
              </div>
            )}
          </FieldRow>

          {platform === "linear" && linearRecord && (
            <FieldRow label={t("destinations.field.organization")}>
              {linearRecord.organization ? (
                <p className="text-sm">
                  {t("connections.workspace", { name: linearRecord.organization.name, id: linearRecord.organization.id })}
                </p>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">{t("connections.workspace.unverified")}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void verifyOrg()} aria-disabled={verifying}>
                    {verifying && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    {t("connections.workspace.verify")}
                  </Button>
                </div>
              )}
            </FieldRow>
          )}

          {platform === "github" ? (
            <FieldRow label={t("github.section.repo")}>
              <ConnectionRepoCombobox
                connectionId={record?.id}
                value={repo}
                onChange={setRepo}
                ariaLabel={t("github.section.repo")}
              />
            </FieldRow>
          ) : (
            <>
              <FieldRow label={t("linear.section.team")}>
                <ConnectionTeamCombobox
                  connectionId={orgVerified ? record?.id : undefined}
                  value={team}
                  onChange={(next) => {
                    setTeam(next);
                    setProject(null);
                  }}
                />
              </FieldRow>
              <FieldRow label={t("linear.field.project")}>
                <ConnectionProjectCombobox
                  connectionId={orgVerified ? record?.id : undefined}
                  teamId={team?.teamId}
                  value={project?.id}
                  valueName={project?.name}
                  onChange={(id, name) => setProject(id ? { id, name: name ?? id } : null)}
                />
              </FieldRow>
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
