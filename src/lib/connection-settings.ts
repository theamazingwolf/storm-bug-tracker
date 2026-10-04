import { normalizeWebsiteOrigin } from "./site-destination-routing";

export type ConnectionSettingsErrorCode =
  | "unknown-connection"
  | "unknown-destination"
  | "invalid-destination"
  | "invalid-origin"
  | "invalid-organization"
  | "organization-unverified"
  | "organization-mismatch"
  | "account-mismatch"
  | "platform-mismatch";

/** Thrown by settings-store connection/destination/origin actions. The message never carries credentials. */
export class ConnectionSettingsError extends Error {
  constructor(
    readonly code: ConnectionSettingsErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "ConnectionSettingsError";
  }
}

const BARE_ORIGIN = /^https?:\/\/[^/?#@\\*]+\/?$/i;

/**
 * Canonical origin for a website mapping rule, or null when `input` is anything but a bare HTTP(S)
 * origin (path, query, fragment, credentials, wildcard). A single trailing slash is tolerated and
 * dropped; scheme/host case and default ports are normalized by `URL.origin`.
 */
export function canonicalMappingOrigin(input: string): string | null {
  const raw = input.trim();
  if (!BARE_ORIGIN.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return normalizeWebsiteOrigin(raw);
  } catch {
    return null;
  }
}
