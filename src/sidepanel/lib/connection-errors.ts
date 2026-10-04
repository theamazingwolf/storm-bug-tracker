import type { TranslationKey } from "@/i18n/ko";
import { ConnectionSettingsError, type ConnectionSettingsErrorCode } from "@/lib/connection-settings";

const KEYS: Record<ConnectionSettingsErrorCode, TranslationKey> = {
  "unknown-connection": "connections.error.unknown",
  "unknown-destination": "origins.error.unknownDestination",
  "invalid-destination": "destinations.error.invalid",
  "invalid-origin": "origins.error.invalid",
  "invalid-organization": "connections.error.orgUnverified",
  "organization-unverified": "connections.error.orgUnverified",
  "organization-mismatch": "connections.error.orgMismatch",
  "account-mismatch": "connections.error.accountMismatch",
  "platform-mismatch": "destinations.error.invalid",
  "duplicate-connection": "connections.error.duplicate",
  "identity-unverified": "connections.error.identityUnverified",
};

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Store errors carry a stable code; the UI shows a localized sentence and never the raw message. */
export function connectionErrorMessage(t: Translate, err: unknown): string {
  if (err instanceof ConnectionSettingsError) return t(KEYS[err.code]);
  return err instanceof Error ? err.message : String(err);
}

/** Re-throws store errors as plain localized Errors so generic toast paths (PlatformConnectFlow) show them. */
export function toLocalizedError(t: Translate, err: unknown): Error {
  return err instanceof ConnectionSettingsError ? new Error(t(KEYS[err.code])) : err instanceof Error ? err : new Error(String(err));
}
