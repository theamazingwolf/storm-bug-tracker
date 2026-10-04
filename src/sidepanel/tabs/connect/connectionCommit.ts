import { sendBg } from "@/lib/bg-client";
import { ConnectionSettingsError } from "@/lib/connection-settings";
import { useSettingsStore } from "@/store/settings-store";
import type { BgRequest } from "@/types/messages";
import type { LinearOrganizationProvenance } from "@/types/connection";
import type { GithubAccount, GithubMyself } from "@/types/github";
import type { LinearAccount, LinearMyself, LinearOrganization } from "@/types/linear";

const store = () => useSettingsStore.getState();

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
async function providerViewerId<T extends GithubMyself | LinearMyself>(request: BgRequest): Promise<T["id"]> {
  try {
    const me = await sendBg<T>(request);
    if (me?.id === undefined || me.id === null || me.id === "") throw new Error("missing viewer id");
    return me.id;
  } catch {
    throw new ConnectionSettingsError("identity-unverified");
  }
}

/**
 * Stores a validated GitHub credential. With `connectionId` it reconnects exactly that record
 * (immutable viewer id must match; the old credential is never replaced otherwise). Without it, it
 * adds a new record next to the existing ones and never touches the selection of another record.
 */
export async function commitGithubAccount(account: GithubAccount, connectionId?: string): Promise<string> {
  if (connectionId) {
    const prior = store().getConnection("github", connectionId);
    if (!prior) throw new ConnectionSettingsError("unknown-connection");
    const verifiedPriorViewerId =
      prior.account.auth.viewerId === undefined
        ? await providerViewerId<GithubMyself>({ type: "github.getMyself", connectionId })
        : undefined;
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
 * Linear counterpart. The workspace of the NEW credential is read through a short-lived candidate
 * record holding only that credential, so an existing record keeps its old token until identity
 * and workspace both match; the candidate is removed before the exact-id put (reconnect) or
 * becomes the new connection (add).
 */
export async function commitLinearAccount(account: LinearAccount, connectionId?: string): Promise<string> {
  let verifiedPriorViewerId: string | undefined;
  if (connectionId) {
    const prior = store().getConnection("linear", connectionId);
    if (!prior) throw new ConnectionSettingsError("unknown-connection");
    if (prior.account.auth.viewerId === undefined) {
      verifiedPriorViewerId = await providerViewerId<LinearMyself>({ type: "linear.getMyself", connectionId });
    }
  }

  const candidateId = store().addConnection("linear", account);
  let organization: LinearOrganizationProvenance;
  try {
    organization = parseOrganization(
      await sendBg<LinearOrganization>({ type: "linear.getOrganization", connectionId: candidateId }),
    );
  } catch (err) {
    store().removeConnection("linear", candidateId);
    throw err;
  }

  if (connectionId) {
    store().removeConnection("linear", candidateId);
    store().putConnectionAccount("linear", connectionId, account, { organization, verifiedPriorViewerId });
    return connectionId;
  }

  const incoming = account.auth.viewerId;
  const duplicate = store().connections.linear.some(
    (record) =>
      record.id !== candidateId &&
      record.organization?.id === organization.id &&
      incoming !== undefined &&
      record.account.auth.viewerId === incoming,
  );
  if (duplicate) {
    store().removeConnection("linear", candidateId);
    throw new ConnectionSettingsError("duplicate-connection");
  }
  store().setLinearConnectionOrganization(candidateId, organization);
  return candidateId;
}

/** Fills in the workspace of a stored Linear record (legacy singleton) using that record's own credential. */
export async function verifyLinearOrganization(connectionId: string): Promise<void> {
  if (!store().getConnection("linear", connectionId)) throw new ConnectionSettingsError("unknown-connection");
  const organization = parseOrganization(await sendBg<LinearOrganization>({ type: "linear.getOrganization", connectionId }));
  store().setLinearConnectionOrganization(connectionId, organization);
}
