import type {
  ConnectionRecords,
  DestinationProfile,
  GithubConnection,
  LinearConnection,
} from "@/types/connection";

export type ResolvedDestinationBinding =
  | {
      ok: true;
      binding: DestinationProfile;
      connection: GithubConnection | LinearConnection;
    }
  | {
      ok: false;
      reason: "missing-connection";
      binding: DestinationProfile;
    };

/** Compare only provider target identity; display-only profile names never affect a draft binding. */
export function sameDestinationTarget(a: DestinationProfile, b: DestinationProfile): boolean {
  if (a.platform !== b.platform || a.connectionId !== b.connectionId) return false;
  return a.platform === "github" && b.platform === "github"
    ? a.owner === b.owner && a.repo === b.repo
    : a.platform === "linear" && b.platform === "linear"
      ? a.organizationId === b.organizationId && a.teamId === b.teamId && a.projectId === b.projectId
      : false;
}

/** Store only the provider-native target and connection ID, not profile/default/account projections. */
export function cloneDestinationBinding(profile: DestinationProfile): DestinationProfile {
  return profile.platform === "github"
    ? {
        id: profile.id,
        platform: "github",
        connectionId: profile.connectionId,
        owner: profile.owner,
        repo: profile.repo,
      }
    : {
        id: profile.id,
        platform: "linear",
        connectionId: profile.connectionId,
        organizationId: profile.organizationId,
        teamId: profile.teamId,
        ...(profile.projectId ? { projectId: profile.projectId } : {}),
      };
}

/** Resolve credentials by the draft's ID; an active/global connection is never a fallback. */
export function resolveDestinationBinding(
  binding: DestinationProfile,
  connections: ConnectionRecords,
): ResolvedDestinationBinding {
  const connection = connections[binding.platform].find(
    (candidate) => candidate.id === binding.connectionId,
  );
  return connection
    ? { ok: true, binding: cloneDestinationBinding(binding), connection }
    : { ok: false, reason: "missing-connection", binding: cloneDestinationBinding(binding) };
}
