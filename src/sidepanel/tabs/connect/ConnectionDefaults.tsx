import { useT } from "@/i18n";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { useSettingsStore } from "@/store/settings-store";
import type { GithubConnection, LinearConnection } from "@/types/connection";
import {
  ConnectionGithubAssigneeCombobox,
  ConnectionGithubLabelCombobox,
  ConnectionLinearAssigneeCombobox,
  ConnectionLinearLabelCombobox,
  ConnectionProjectCombobox,
  ConnectionTeamCombobox,
  type TeamPick,
} from "@/sidepanel/tabs/destinations/ConnectionPickers";
import { ConnectionRepoCombobox } from "@/sidepanel/tabs/destinations/ConnectionRepoCombobox";

/** Per-connection prefill defaults. Every request carries this record's id, never the selected one. */
export function GithubConnectionDefaults({ record }: { record: GithubConnection }) {
  const t = useT();
  const updateConnection = useSettingsStore((s) => s.updateConnection);
  const defaults = record.account.defaults;
  const value = defaults.owner && defaults.repo ? { owner: defaults.owner, repo: defaults.repo } : null;
  return (
    <div className="flex flex-col gap-3" data-testid={`connection-defaults-${record.id}`}>
      <FieldRow label={t("github.section.repo")}>
        <ConnectionRepoCombobox
          connectionId={record.id}
          value={value}
          ariaLabel={t("connections.defaults.field", { field: t("github.section.repo"), name: record.account.auth.viewerLogin })}
          onChange={(next) =>
            // label·assignee는 repo 하위 값이라 repo가 바뀌면(교체·해제 모두) 함께 비운다.
            updateConnection("github", record.id, {
              defaults: { ...defaults, owner: next?.owner, repo: next?.repo, label: undefined, assignee: undefined },
            })
          }
        />
      </FieldRow>
      <FieldRow label={t("github.field.labels")}>
        <ConnectionGithubLabelCombobox
          connectionId={record.id}
          owner={defaults.owner}
          repo={defaults.repo}
          value={defaults.label}
          onChange={(label) => updateConnection("github", record.id, { defaults: { ...defaults, label } })}
        />
      </FieldRow>
      <FieldRow label={t("github.field.assignee")}>
        <ConnectionGithubAssigneeCombobox
          connectionId={record.id}
          owner={defaults.owner}
          repo={defaults.repo}
          value={defaults.assignee}
          onChange={(assignee) => updateConnection("github", record.id, { defaults: { ...defaults, assignee } })}
        />
      </FieldRow>
    </div>
  );
}

export function LinearConnectionDefaults({ record }: { record: LinearConnection }) {
  const t = useT();
  const updateConnection = useSettingsStore((s) => s.updateConnection);
  const defaults = record.account.defaults;
  const team: TeamPick | null =
    defaults.teamId && defaults.teamName
      ? { teamId: defaults.teamId, teamName: defaults.teamName, teamKey: defaults.teamKey ?? "" }
      : null;
  return (
    <div className="flex flex-col gap-3" data-testid={`connection-defaults-${record.id}`}>
      <FieldRow label={t("linear.section.team")}>
        <ConnectionTeamCombobox
          connectionId={record.id}
          value={team}
          onChange={(next) =>
            // project·label·assignee는 team 하위 값이라 team이 바뀌면(교체·해제 모두) 함께 비운다.
            updateConnection("linear", record.id, {
              defaults: {
                ...defaults,
                teamId: next?.teamId,
                teamName: next?.teamName,
                teamKey: next?.teamKey,
                projectId: undefined,
                projectName: undefined,
                labelId: undefined,
                labelName: undefined,
                assigneeId: undefined,
                assigneeName: undefined,
              },
            })
          }
        />
      </FieldRow>
      <FieldRow label={t("linear.field.project")}>
        <ConnectionProjectCombobox
          connectionId={record.id}
          teamId={defaults.teamId}
          value={defaults.projectId}
          valueName={defaults.projectName}
          onChange={(projectId, projectName) =>
            updateConnection("linear", record.id, { defaults: { ...defaults, projectId, projectName } })
          }
        />
      </FieldRow>
      <FieldRow label={t("linear.field.labels")}>
        <ConnectionLinearLabelCombobox
          connectionId={record.id}
          teamId={defaults.teamId}
          value={defaults.labelId}
          valueName={defaults.labelName}
          onChange={(labelId, labelName) =>
            updateConnection("linear", record.id, { defaults: { ...defaults, labelId, labelName } })
          }
        />
      </FieldRow>
      <FieldRow label={t("linear.field.assignee")}>
        <ConnectionLinearAssigneeCombobox
          connectionId={record.id}
          teamId={defaults.teamId}
          value={defaults.assigneeId}
          valueName={defaults.assigneeName}
          onChange={(assigneeId, assigneeName) =>
            updateConnection("linear", record.id, { defaults: { ...defaults, assigneeId, assigneeName } })
          }
        />
      </FieldRow>
    </div>
  );
}
