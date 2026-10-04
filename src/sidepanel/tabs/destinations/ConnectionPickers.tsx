import { useCallback, type ReactNode } from "react";
import { useT } from "@/i18n";
import { sendBg } from "@/lib/bg-client";
import { ColorSwatch } from "@/sidepanel/components/ColorSwatch";
import { SingleLazyCombobox } from "@/sidepanel/components/SingleLazyCombobox";
import type { GithubLabel, GithubUser } from "@/types/github";
import type { LinearLabel, LinearProject, LinearTeam, LinearUser } from "@/types/linear";

// Every picker here sends `connectionId` and builds `load` from it, so SingleLazyCombobox's
// load-identity reset discards lists (and in-flight responses) from the previous connection or scope.

// SingleLazyCombobox's trigger only exposes its current value as its name; the group gives the
// field a stable accessible name ("Team", "Project", ...) that survives value changes.
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      {children}
    </div>
  );
}

export interface TeamPick {
  teamId: string;
  teamName: string;
  teamKey: string;
}

export function ConnectionTeamCombobox({
  connectionId,
  value,
  onChange,
}: {
  connectionId: string | undefined;
  value: TeamPick | null;
  onChange: (next: TeamPick | null) => void;
}) {
  const t = useT();
  const load = useCallback(
    () => sendBg<LinearTeam[]>({ type: "linear.getTeams", connectionId }),
    [connectionId],
  );
  return (
    <Labeled label={t("linear.section.team")}>
      <SingleLazyCombobox
        disabled={!connectionId}
        load={load}
        getKey={(team) => team.id}
        getName={(team) => `${team.key} ${team.name}`}
        renderItem={(team) => <span className="truncate">{team.key} — {team.name}</span>}
        selectedKey={value?.teamId ?? null}
        onSelect={(team) => onChange(team ? { teamId: team.id, teamName: team.name, teamKey: team.key } : null)}
        triggerLabel={value ? (value.teamKey ? `${value.teamKey} — ${value.teamName}` : value.teamName) : t("linear.field.team.select")}
        searchPlaceholder={t("linear.field.team.search")}
        emptyLabel={t("linear.field.team.empty")}
      />
    </Labeled>
  );
}

export function ConnectionProjectCombobox({
  connectionId,
  teamId,
  value,
  valueName,
  onChange,
}: {
  connectionId: string | undefined;
  teamId: string | undefined;
  value: string | undefined;
  valueName?: string;
  onChange: (projectId: string | undefined, projectName: string | undefined) => void;
}) {
  const t = useT();
  const ready = !!connectionId && !!teamId;
  const load = useCallback(
    () => sendBg<LinearProject[]>({ type: "linear.getProjects", teamId: teamId!, connectionId }),
    [connectionId, teamId],
  );
  return (
    <Labeled label={t("linear.field.project")}>
      <SingleLazyCombobox
        disabled={!ready}
        load={load}
        getKey={(p) => p.id}
        getName={(p) => p.name}
        selectedKey={value ?? null}
        onSelect={(p) => onChange(p?.id, p?.name)}
        triggerLabel={!teamId ? t("linear.field.requireTeam") : (value ? valueName ?? value : t("linear.field.project.select"))}
        searchPlaceholder={t("linear.field.project.search")}
        emptyLabel={t("linear.field.project.empty")}
      />
    </Labeled>
  );
}

export function ConnectionLinearLabelCombobox({
  connectionId,
  teamId,
  value,
  valueName,
  onChange,
}: {
  connectionId: string | undefined;
  teamId: string | undefined;
  value: string | undefined;
  valueName?: string;
  onChange: (labelId: string | undefined, labelName: string | undefined) => void;
}) {
  const t = useT();
  const ready = !!connectionId && !!teamId;
  const load = useCallback(
    () => sendBg<LinearLabel[]>({ type: "linear.getLabels", teamId: teamId!, connectionId }),
    [connectionId, teamId],
  );
  return (
    <Labeled label={t("linear.field.labels")}>
      <SingleLazyCombobox
        disabled={!ready}
        load={load}
        getKey={(l) => l.id}
        getName={(l) => l.name}
        renderItem={(l) => (
          <>
            <ColorSwatch shape="round" color={l.color} className="mr-2" />
            <span className="truncate">{l.name}</span>
          </>
        )}
        selectedKey={value ?? null}
        onSelect={(l) => onChange(l?.id, l?.name)}
        triggerLabel={!teamId ? t("linear.field.requireTeam") : (value ? valueName ?? value : t("linear.field.labels.select"))}
        searchPlaceholder={t("linear.field.labels.search")}
        emptyLabel={t("linear.field.labels.empty")}
      />
    </Labeled>
  );
}

export function ConnectionLinearAssigneeCombobox({
  connectionId,
  teamId,
  value,
  valueName,
  onChange,
}: {
  connectionId: string | undefined;
  teamId: string | undefined;
  value: string | undefined;
  valueName?: string;
  onChange: (assigneeId: string | undefined, assigneeName: string | undefined) => void;
}) {
  const t = useT();
  const ready = !!connectionId && !!teamId;
  const load = useCallback(
    () => sendBg<LinearUser[]>({ type: "linear.getMembers", teamId: teamId!, connectionId }),
    [connectionId, teamId],
  );
  return (
    <Labeled label={t("linear.field.assignee")}>
      <SingleLazyCombobox
        disabled={!ready}
        load={load}
        getKey={(u) => u.id}
        getName={(u) => u.name}
        getItemValue={(u) => `${u.name} ${u.email ?? ""} ${u.id}`}
        selectedKey={value ?? null}
        onSelect={(u) => onChange(u?.id, u?.name)}
        triggerLabel={!teamId ? t("linear.field.requireTeam") : (value ? valueName ?? value : t("linear.field.assignee.select"))}
        searchPlaceholder={t("linear.field.assignee.search")}
        emptyLabel={t("linear.field.assignee.empty")}
      />
    </Labeled>
  );
}

export function ConnectionGithubLabelCombobox({
  connectionId,
  owner,
  repo,
  value,
  onChange,
}: {
  connectionId: string | undefined;
  owner: string | undefined;
  repo: string | undefined;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const t = useT();
  const ready = !!connectionId && !!owner && !!repo;
  const load = useCallback(
    () => sendBg<GithubLabel[]>({ type: "github.getLabels", owner: owner!, repo: repo!, connectionId }),
    [connectionId, owner, repo],
  );
  return (
    <Labeled label={t("github.field.labels")}>
      <SingleLazyCombobox
        disabled={!ready}
        load={load}
        getKey={(l) => l.name}
        getName={(l) => l.name}
        renderItem={(l) => (
          <>
            <ColorSwatch shape="round" color={l.color} className="mr-2" />
            <span className="truncate">{l.name}</span>
          </>
        )}
        selectedKey={value ?? null}
        onSelect={(l) => onChange(l?.name)}
        triggerLabel={!owner || !repo ? t("github.field.requireRepo") : (value ?? t("github.field.labels.placeholder"))}
        searchPlaceholder={t("github.field.labels.search")}
        emptyLabel={t("github.field.labels.empty")}
      />
    </Labeled>
  );
}

export function ConnectionGithubAssigneeCombobox({
  connectionId,
  owner,
  repo,
  value,
  onChange,
}: {
  connectionId: string | undefined;
  owner: string | undefined;
  repo: string | undefined;
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const t = useT();
  const ready = !!connectionId && !!owner && !!repo;
  const load = useCallback(
    () => sendBg<GithubUser[]>({ type: "github.searchAssignees", owner: owner!, repo: repo!, connectionId }),
    [connectionId, owner, repo],
  );
  return (
    <Labeled label={t("github.field.assignee")}>
      <SingleLazyCombobox
        disabled={!ready}
        load={load}
        getKey={(u) => u.login}
        getName={(u) => u.login}
        selectedKey={value ?? null}
        onSelect={(u) => onChange(u?.login)}
        triggerLabel={!owner || !repo ? t("github.field.requireRepo") : (value ?? t("github.field.assignee.placeholder"))}
        searchPlaceholder={t("github.field.assignee.search")}
        emptyLabel={t("github.field.assignee.empty")}
      />
    </Labeled>
  );
}
