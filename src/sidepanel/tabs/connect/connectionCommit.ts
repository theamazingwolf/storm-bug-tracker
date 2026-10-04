import { sendBg } from "@/lib/bg-client";
import { ConnectionSettingsError } from "@/lib/connection-settings";
import { useSettingsStore } from "@/store/settings-store";
import type { BgRequest } from "@/types/messages";
import type { LinearOrganizationProvenance } from "@/types/connection";
import type { GithubAccount, GithubMyself } from "@/types/github";
import type { LinearAccount, LinearMyself, LinearOrganization } from "@/types/linear";

const store = () => useSettingsStore.getState();

/** Result of `linear.inspectAuth`: a read made with the NEW credential only (no saved-connection lookup). */
interface LinearAuthInspection {
  viewer: LinearMyself;
  organization: LinearOrganization;
}

function abortError(): Error {
  return new DOMException("Connection attempt abandoned", "AbortError");
}

/** Called after every await: an abandoned attempt (dialog closed, flow unmounted) must never write. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

export function isAbandoned(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function parseOrganization(value: LinearOrganization | undefined): LinearOrganizationProvenance {
  const id = typeof value?.id === "string" ? value.id.trim() : "";
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  if (!id || !name) throw new ConnectionSettingsError("invalid-organization");
  return { id, name };
}

/**
 * Asks the provider who the *stored* credentials of a legacy record (saved before immutable
 * viewer ids existed) belong to. Any failure means identity cannot be proven, so the caller must
 * not overwrite: the user adds a new connection instead and the old record keeps its settings.
 */
async function providerViewerId<T extends GithubMyself | LinearMyself>(request: BgRequest, signal?: AbortSignal): Promise<T["id"]> {
  try {
    const me = await sendBg<T>(request);
    throwIfAborted(signal);
    if (me?.id === undefined || me.id === null || me.id === "") throw new Error("missing viewer id");
    return me.id;
  } catch (err) {
    if (isAbandoned(err)) throw err;
    throw new ConnectionSettingsError("identity-unverified");
  }
}

/**
 * Stores a validated GitHub credential. With `connectionId` it reconnects exactly that record
 * (immutable viewer id must match; the old credential is never replaced otherwise). Without it, it
 * adds a new record next to the existing ones and never touches the selection of another record.
 */
export async function commitGithubAccount(account: GithubAccount, connectionId?: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (connectionId) {
    const prior = store().getConnection("github", connectionId);
    if (!prior) throw new ConnectionSettingsError("unknown-connection");
    const verifiedPriorViewerId =
      prior.account.auth.viewerId === undefined
        ? await providerViewerId<GithubMyself>({ type: "github.getMyself", connectionId }, signal)
        : undefined;
    throwIfAborted(signal);
    store().putConnectionAccount("github", connectionId, account, { verifiedPriorViewerId });
    return connectionId;
  }
  const incoming = account.auth.viewerId;
  const duplicate = store().connections.github.some((record) => {
    const existing = record.account.auth;
    if (existing.viewerId !== undefined && incoming !== undefined) return existing.viewerId === incoming;
    return existing.viewerLogin.toLowerCase() === account.auth.viewerLogin.toLowerCase();
  });
  if (duplicate) throw new ConnectionSettingsError("duplicate-connection");
  return store().addConnection("github", account);
}

/**
 * Linear counterpart. Nothing is written until the provider has vouched for the NEW credential:
 * `linear.inspectAuth` returns its viewer and workspace without touching any saved connection, so
 * there is no staging record to leak. Only then is a single store write made (reconnect: exact-id
 * put, which re-checks viewer id + workspace against the target; add: one `addConnection` carrying
 * the verified workspace). An aborted attempt (`signal`) never reaches the write.
 */
export async function commitLinearAccount(account: LinearAccount, connectionId?: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  let verifiedPriorViewerId: string | undefined;
  if (connectionId) {
    const prior = store().getConnection("linear", connectionId);
    if (!prior) throw new ConnectionSettingsError("unknown-connection");
    if (prior.account.auth.viewerId === undefined) {
      verifiedPriorViewerId = await providerViewerId<LinearMyself>({ type: "linear.getMyself", connectionId }, signal);
    }
  }

  const inspection = await sendBg<LinearAuthInspection>({ type: "linear.inspectAuth", auth: account.auth });
  throwIfAborted(signal);
  const providerId = typeof inspection?.viewer?.id === "string" ? inspection.viewer.id.trim() : "";
  if (!providerId) throw new ConnectionSettingsError("identity-unverified");
  if (account.auth.viewerId !== undefined && account.auth.viewerId !== providerId) {
    throw new ConnectionSettingsError("identity-unverified");
  }
  const organization = parseOrganization(inspection.organization);
  const proven: LinearAccount = { ...account, auth: { ...account.auth, viewerId: providerId } };

  // Everything below is synchronous: the store is re-read now, so a record deleted or changed while the
  // lookup was pending is seen as it is (an unknown id fails; it is never recreated).
  throwIfAborted(signal);
  if (connectionId) {
    store().putConnectionAccount("linear", connectionId, proven, { organization, verifiedPriorViewerId });
    return connectionId;
  }
  const duplicate = store().connections.linear.some(
    (record) => record.organization?.id === organization.id && record.account.auth.viewerId === providerId,
  );
  if (duplicate) throw new ConnectionSettingsError("duplicate-connection");
  return store().addConnection("linear", proven, { organization });
}

/** Fills in the workspace of a stored Linear record (legacy singleton) using that record's own credential. */
export async function verifyLinearOrganization(connectionId: string): Promise<void> {
  if (!store().getConnection("linear", connectionId)) throw new ConnectionSettingsError("unknown-connection");
  const organization = parseOrganization(await sendBg<LinearOrganization>({ type: "linear.getOrganization", connectionId }));
  store().setLinearConnectionOrganization(connectionId, organization);
}
