import type { DestinationProfile, GithubConnection, LinearConnection } from "@/types/connection";

type AnyConnection = GithubConnection | LinearConnection;

/** Human label for one stored account: GitHub login, or Linear viewer plus verified workspace. */
export function connectionLabel(record: AnyConnection): string {
  if (record.platform === "github") return record.account.auth.viewerLogin;
  const { viewerName } = record.account.auth;
  return record.organization ? `${viewerName} · ${record.organization.name}` : viewerName;
}

/** Title of a destination profile; Linear uses the display snapshots saved with it, falling back to ids. */
export function destinationTitle(profile: DestinationProfile): string {
  if (profile.platform === "github") return `${profile.owner}/${profile.repo}`;
  const team = profile.teamKey && profile.teamName
    ? `${profile.teamKey} — ${profile.teamName}`
    : profile.teamName ?? profile.teamKey ?? profile.teamId;
  if (!profile.projectId) return team;
  return `${team} / ${profile.projectName ?? profile.projectId}`;
}
