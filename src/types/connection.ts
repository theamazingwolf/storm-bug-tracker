import type { GithubAccount, GithubDefaults } from "./github";
import type { GithubLastSubmitFields, LinearLastSubmitFields } from "./platform";
import type { LinearAccount, LinearDefaults } from "./linear";

export interface LinearOrganizationProvenance {
  id: string;
  name: string;
}

export interface GithubConnection {
  id: string;
  platform: "github";
  account: GithubAccount;
  lastSubmitFields?: GithubLastSubmitFields;
}

export interface LinearConnection {
  id: string;
  platform: "linear";
  account: LinearAccount;
  organization?: LinearOrganizationProvenance;
  lastSubmitFields?: LinearLastSubmitFields;
}

export interface ConnectionRecords {
  github: GithubConnection[];
  linear: LinearConnection[];
}

export interface SelectedConnectionIds {
  github?: string;
  linear?: string;
}

export type RoutablePlatform = "github" | "linear";

export interface GithubDestinationProfile {
  id: string;
  platform: "github";
  connectionId: string;
  owner: string;
  repo: string;
}

export interface LinearDestinationProfile {
  id: string;
  platform: "linear";
  connectionId: string;
  organizationId: string;
  teamId: string;
  projectId?: string;
  /** Display-only snapshots captured at save time; routing and requests use the ids. */
  teamName?: string;
  teamKey?: string;
  projectName?: string;
}

export type DestinationProfile = GithubDestinationProfile | LinearDestinationProfile;

export interface WebsiteOriginMapping {
  /** Canonical URL origin only, for example `https://example.com`. */
  origin: string;
  destinationId: string;
}

export interface ConnectionUpdate<P extends RoutablePlatform> {
  defaults?: P extends "github" ? GithubDefaults : LinearDefaults;
  lastSubmitFields?: P extends "github" ? GithubLastSubmitFields : LinearLastSubmitFields;
}

export interface AddLinearConnectionOptions {
  organization?: LinearOrganizationProvenance;
}

/**
 * Reconnect of one exact record. `verifiedPriorViewerId` is the immutable provider id obtained by
 * calling the provider with the record's STILL-STORED credential; it is only consulted when the
 * record predates immutable ids, never inferred from display names.
 */
export interface PutGithubConnectionOptions {
  verifiedPriorViewerId?: number;
}

export interface PutLinearConnectionOptions extends AddLinearConnectionOptions {
  verifiedPriorViewerId?: string;
}
