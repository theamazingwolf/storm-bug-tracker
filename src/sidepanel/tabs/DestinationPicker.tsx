import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings-store";
import type { DestinationProfile, RoutablePlatform } from "@/types/connection";
import { matchWebsiteOrigin, normalizeWebsiteOrigin } from "@/lib/site-destination-routing";
import { connectionLabel, destinationTitle } from "@/sidepanel/lib/connection-labels";
import { sameDestinationTarget } from "@/sidepanel/lib/destinationBinding";
import { GithubConnectFlow } from "./connect/GithubConnectForm";
import { LinearConnectFlow } from "./connect/LinearConnectForm";
import { ConnectionProjectCombobox, ConnectionTeamCombobox, type TeamPick } from "./destinations/ConnectionPickers";
import { ConnectionRepoCombobox, type ConnectionRepoValue } from "./destinations/ConnectionRepoCombobox";

interface Props {
  platform: RoutablePlatform;
  origin: string | null;
  value: DestinationProfile | null;
  onChange: (value: DestinationProfile | null) => void;
  disabled?: boolean;
}

function newDestinationId(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("Secure random IDs are unavailable");
  return `dest-${id}`;
}

export function DestinationPicker({ platform, origin, value, onChange, disabled }: Props) {
  const t = useT();
  const profiles = useSettingsStore((s) => s.destinationProfiles);
  const mappings = useSettingsStore((s) => s.websiteOriginMappings);
  const connections = useSettingsStore((s) => s.connections);
  const saveDestinationProfile = useSettingsStore((s) => s.saveDestinationProfile);
  const setWebsiteOriginMapping = useSettingsStore((s) => s.setWebsiteOriginMapping);
  const [newConnectionId, setNewConnectionId] = useState<string | null>(null);
  const [newRepo, setNewRepo] = useState<ConnectionRepoValue | null>(null);
  const [newTeam, setNewTeam] = useState<TeamPick | null>(null);
  const [newProject, setNewProject] = useState<{ id: string; name: string } | null>(null);
  const options = useMemo(() => profiles.filter((profile) => profile.platform === platform), [profiles, platform]);
  const match = origin ? matchWebsiteOrigin(origin, mappings, profiles) : { status: "unsupported" as const };
  const canonicalOrigin = origin ? normalizeWebsiteOrigin(origin) : null;
  const selectedProfile = value?.platform === platform ? value : null;
  const selectedConnectionExists = !!selectedProfile && (selectedProfile.platform === "github"
    ? connections.github.some((connection) => connection.id === selectedProfile.connectionId)
    : connections.linear.some((connection) => connection.id === selectedProfile.connectionId));
  const savedVersion = selectedProfile ? options.find((profile) => profile.id === selectedProfile.id) : undefined;
  const selectedProfileIsSaved = !!selectedProfile && !!savedVersion && sameDestinationTarget(selectedProfile, savedVersion);
  const selectedValue = selectedProfile
    ? `${selectedProfileIsSaved ? "saved" : "snapshot"}:${selectedProfile.id}`
    : "";
  const optionLabel = (profile: DestinationProfile) => {
    const connection = profile.platform === "github"
      ? connections.github.find((item) => item.id === profile.connectionId)
      : connections.linear.find((item) => item.id === profile.connectionId);
    return `${connection ? connectionLabel(connection) : t("destination.connectionMissing")} · ${destinationTitle(profile)}`;
  };
  const platformConnections = platform === "github" ? connections.github : connections.linear;
  const newLinearConnection = connections.linear.find((item) => item.id === newConnectionId);
  const newConnectionExists = platformConnections.some((connection) => connection.id === newConnectionId);

  function selectProfileConnection(id: string) {
    setNewConnectionId(id || null);
    setNewRepo(null);
    setNewTeam(null);
    setNewProject(null);
  }

  useEffect(() => {
    setNewConnectionId(null);
    setNewRepo(null);
    setNewTeam(null);
    setNewProject(null);
  }, [platform]);

  function saveGithubProfile() {
    if (!newConnectionId || !newRepo || !connections.github.some((connection) => connection.id === newConnectionId)) return;
    const profile: DestinationProfile = {
      id: newDestinationId(), platform: "github", connectionId: newConnectionId,
      owner: newRepo.owner, repo: newRepo.repo,
    };
    saveDestinationProfile(profile);
    onChange(profile);
    setNewConnectionId(null);
    setNewRepo(null);
  }

  function saveLinearProfile() {
    if (!newLinearConnection?.organization || !newTeam) return;
    const profile: DestinationProfile = {
      id: newDestinationId(), platform: "linear", connectionId: newLinearConnection.id,
      organizationId: newLinearConnection.organization.id,
      teamId: newTeam.teamId, teamName: newTeam.teamName, teamKey: newTeam.teamKey,
      ...(newProject ? { projectId: newProject.id, projectName: newProject.name } : {}),
    };
    saveDestinationProfile(profile);
    onChange(profile);
    setNewConnectionId(null);
    setNewTeam(null);
    setNewProject(null);
  }

  const triggerLabel = t("connections.addAnother", { platform: t(platform === "github" ? "platform.tab.github" : "platform.tab.linear") });
  const trigger = (props: { onClick: () => void; connecting: boolean; disabled: boolean }) => (
    <Button type="button" variant="outline" size="sm" disabled={disabled || props.disabled} onClick={props.onClick}>
      {props.connecting ? t("common.loading") : triggerLabel}
    </Button>
  );

  return (
    <section className="flex flex-col gap-2" aria-label={t("destination.label")} data-testid="destination-picker">
      <label className="text-sm font-medium" htmlFor="capture-destination">{t("destination.label")}</label>
      <select
        id="capture-destination"
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => {
          const [kind, id] = event.target.value.split(":", 2);
          if (kind === "saved") onChange(options.find((profile) => profile.id === id) ?? null);
          else if (kind === "snapshot") onChange(selectedProfile);
          else onChange(null);
        }}
      >
        <option value="">{t("destination.choose")}</option>
        {selectedProfile && !selectedProfileIsSaved ? (
          <option value={`snapshot:${selectedProfile.id}`}>{optionLabel(selectedProfile)}</option>
        ) : null}
        {options.map((profile) => (
          <option key={profile.id} value={`saved:${profile.id}`}>{optionLabel(profile)}</option>
        ))}
      </select>
      {match.status === "ambiguous" && !selectedProfile && (
        <p className="text-xs text-muted-foreground">{t("destination.ambiguous")}</p>
      )}
      {match.status === "unmatched" && !selectedProfile && (
        <p className="text-xs text-muted-foreground">{t("destination.unmatched")}</p>
      )}
      {selectedProfile && !selectedConnectionExists && (
        <p role="alert" className="text-xs text-destructive">{t("destination.connectionMissing")}</p>
      )}
      {canonicalOrigin && selectedConnectionExists && selectedProfileIsSaved && (
        <button
          type="button"
          className="self-start text-xs text-primary underline-offset-4 hover:underline"
          disabled={disabled}
          onClick={() => setWebsiteOriginMapping(canonicalOrigin, selectedProfile!.id)}
        >
          {t("destination.remember")}
        </button>
      )}

      <label className="text-xs font-medium" htmlFor="destination-connection">{t("destinations.field.connection")}</label>
      <select
        id="destination-connection"
        aria-label={t("destinations.field.connection")}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={newConnectionId ?? ""}
        disabled={disabled}
        onChange={(event) => selectProfileConnection(event.target.value)}
      >
        <option value="">{t("destination.choose")}</option>
        {platformConnections.map((connection) => (
          <option key={connection.id} value={connection.id}>{connectionLabel(connection)}</option>
        ))}
      </select>

      {platform === "github" ? (
        <GithubConnectFlow
          connected={false}
          onConnected={(id) => { if (id) selectProfileConnection(id); }}
          autoStart={false}
          onAutoStartHandled={() => {}}
          renderTrigger={trigger}
          triggerLabel={triggerLabel}
        />
      ) : (
        <LinearConnectFlow
          connected={false}
          onConnected={(id) => { if (id) selectProfileConnection(id); }}
          autoStart={false}
          onAutoStartHandled={() => {}}
          renderTrigger={trigger}
          triggerLabel={triggerLabel}
        />
      )}

      {platform === "github" && newConnectionId && newConnectionExists && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <ConnectionRepoCombobox connectionId={newConnectionId} value={newRepo} onChange={setNewRepo} ariaLabel={t("github.section.repo")} />
          <Button type="button" size="sm" disabled={!newRepo || disabled} onClick={saveGithubProfile}>{t("common.save")}</Button>
        </div>
      )}
      {platform === "linear" && newConnectionId && newConnectionExists && newLinearConnection?.organization && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <ConnectionTeamCombobox connectionId={newConnectionId} value={newTeam} onChange={(team) => { setNewTeam(team); setNewProject(null); }} />
          <ConnectionProjectCombobox connectionId={newConnectionId} teamId={newTeam?.teamId} value={newProject?.id} valueName={newProject?.name} onChange={(id, name) => setNewProject(id && name ? { id, name } : null)} />
          <Button type="button" size="sm" disabled={!newTeam || disabled} onClick={saveLinearProfile}>{t("common.save")}</Button>
        </div>
      )}
      {platform === "linear" && newConnectionId && newConnectionExists && !newLinearConnection?.organization && (
        <p role="alert" className="text-xs text-destructive">{t("connections.workspace.unverified")}</p>
      )}
    </section>
  );
}
