import type { DestinationProfile, GithubConnection, LinearConnection } from "@/types/connection";
import { initialGhFields, type GithubIssueFieldsValue } from "@/sidepanel/tabs/githubFields/GithubIssueFields";
import { initialLinearFields, type LinearIssueFieldsValue } from "@/sidepanel/tabs/linearFields/LinearIssueFields";

export function githubFieldsForDestination(
  binding: Extract<DestinationProfile, { platform: "github" }>,
  connection?: GithubConnection,
): GithubIssueFieldsValue {
  const last = connection?.lastSubmitFields;
  const defaults = connection?.account.defaults;
  const lastMatches = last?.owner === binding.owner && last.repo === binding.repo;
  const defaultsMatch = defaults?.owner === binding.owner && defaults.repo === binding.repo;
  return {
    ...initialGhFields(lastMatches ? last : undefined, defaultsMatch ? defaults : undefined),
    owner: binding.owner,
    repo: binding.repo,
  };
}

export function linearFieldsForDestination(
  binding: Extract<DestinationProfile, { platform: "linear" }>,
  connection?: LinearConnection,
  display?: Extract<DestinationProfile, { platform: "linear" }>,
): LinearIssueFieldsValue {
  const last = connection?.lastSubmitFields;
  const defaults = connection?.account.defaults;
  const lastMatches = last?.teamId === binding.teamId;
  const defaultsMatch = defaults?.teamId === binding.teamId;
  const fields = initialLinearFields(lastMatches ? last : undefined, defaultsMatch ? defaults : undefined);
  return {
    ...fields,
    teamId: binding.teamId,
    teamName: display?.teamName ?? fields.teamName ?? binding.teamId,
    teamKey: display?.teamKey ?? fields.teamKey,
    projectId: binding.projectId,
    projectName: binding.projectId ? display?.projectName ?? fields.projectName ?? binding.projectId : undefined,
  };
}
