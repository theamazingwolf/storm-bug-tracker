import type { JiraAuth } from "@/types/jira";
import type { GithubAuth, GithubOAuthAuth } from "@/types/github";
import type { LinearAuth, LinearOAuthAuth } from "@/types/linear";
import type { NotionAuth } from "@/types/notion";
import type { GitlabAuth } from "@/types/gitlab";
import type { AsanaAuth } from "@/types/asana";
import type { ClickupAuth } from "@/types/clickup";
import type { SlackAuth } from "@/types/slack";
import type { WebhookAuth } from "@/types/webhook";

export const SETTINGS_STORAGE_KEY = "bugshot-settings";
export const CONNECTION_TOKEN_OVERLAY_STORAGE_KEY = "bugshot-connection-token-overlays";

interface GithubTokenOverlay {
  platform: "github";
  connectionId: string;
  grantedAt: number;
  viewerId?: number;
  tokens: Pick<GithubOAuthAuth, "accessToken" | "tokenType" | "scope"> & Partial<Pick<GithubOAuthAuth, "refreshToken" | "expiresAt">>;
}

interface LinearTokenOverlay {
  platform: "linear";
  connectionId: string;
  grantedAt: number;
  viewerId?: string;
  tokens: Pick<LinearOAuthAuth, "accessToken" | "refreshToken" | "expiresAt" | "scope">;
}

interface ConnectionTokenOverlays {
  github?: GithubTokenOverlay[];
  linear?: LinearTokenOverlay[];
}

interface SettingsEnvelope {
  state?: {
    accounts?: {
      jira?: { auth?: JiraAuth };
      github?: { auth?: GithubAuth };
      linear?: { auth?: LinearAuth };
      notion?: { auth?: NotionAuth };
      gitlab?: { auth?: GitlabAuth };
      asana?: { auth?: AsanaAuth };
      clickup?: { auth?: ClickupAuth };
      slack?: { auth?: SlackAuth };
      webhook?: { auth?: WebhookAuth };
    };
    connections?: {
      github?: { id: string; account: { auth?: GithubAuth } }[];
      linear?: { id: string; account: { auth?: LinearAuth }; organization?: { id: string; name: string } }[];
    };
    selectedConnectionIds?: { github?: string; linear?: string };
    jiraConfig?: { auth?: JiraAuth };
  };
  version?: number;
}

type AccountsShape = NonNullable<NonNullable<SettingsEnvelope["state"]>["accounts"]>;
type AccountKey = keyof AccountsShape;
// 토큰 reader/writer는 OAuth를 가진 계정에만 존재한다. webhook의 auth에는 `kind` 판별자가
// 없어서, 이 축을 AccountKey로 두면 아래 `cur.kind` 비교가 통째로 깨진다.
type OAuthAccountKey = Exclude<AccountKey, "webhook">;
type AuthOf<K extends OAuthAccountKey> = NonNullable<NonNullable<AccountsShape[K]>["auth"]>;
type OAuthAuthOf<K extends OAuthAccountKey> = Extract<AuthOf<K>, { kind: "oauth" }>;

async function readEnvelope(): Promise<
  { raw: unknown; envelope: SettingsEnvelope | null }
> {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = result[SETTINGS_STORAGE_KEY];
  if (raw == null) return { raw: null, envelope: null };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { raw, envelope: parsed as SettingsEnvelope };
  } catch {
    return { raw, envelope: null };
  }
}

function reader<K extends OAuthAccountKey>(
  account: K,
  // jira만 v1 시절 `state.jiraConfig.auth`에 저장했다. 그 envelope이 남은 설치본이 있어
  // 폴백을 지우면 조용히 로그아웃된다.
  legacy?: (envelope: SettingsEnvelope) => AuthOf<K> | undefined,
): (connectionId?: string) => Promise<AuthOf<K> | null> {
  return async (connectionId?: string) => {
    const { envelope } = await readEnvelope();
    if (!envelope) return null;
    if (account === "github" || account === "linear") {
      const routeKey = account as "github" | "linear";
      const id = connectionId ?? envelope.state?.selectedConnectionIds?.[routeKey];
      const selected = id ? envelope.state?.connections?.[routeKey]?.find((record) => record.id === id) : undefined;
      if (selected?.account.auth) return selected.account.auth as AuthOf<K>;
      if (connectionId || envelope.state?.selectedConnectionIds?.[routeKey]) return null;
    }
    return envelope.state?.accounts?.[account]?.auth ?? legacy?.(envelope) ?? null;
  };
}

interface OAuthWriteSpec<K extends OAuthAccountKey, A extends OAuthAuthOf<K>> {
  account: K;
  // 갱신 대상 화이트리스트. 여기 없는 필드는 신원(cloudId·viewerLogin·grantedAt·baseUrl 등)이고
  // 갱신 응답에 값이 실려와도 건드리면 안 된다 — gitlab baseUrl은 self-managed 인스턴스 주소라
  // 덮이면 그 계정으로 요청이 안 나간다. `keyof A`는 오타만 막지 목록이 넓어지는 건 못 막으므로,
  // settings-storage.test.ts의 envelope 전량 대조가 그쪽 그물이다.
  fields: readonly (keyof A & string)[];
  // 응답에 값이 없으면 기존 값을 유지할 필드. github만 refreshToken·expiresAt이 optional이라
  // 단순 대입이면 갱신 때마다 refresh token이 지워져 무한 재로그인이 된다.
  keepIfAbsent?: readonly (keyof A & string)[];
}

/**
 * 두 auth가 같은가. `excluded`를 뺀 나머지를 대조하며, **첫 인자의 키만** 순회한다
 * (`a`에 없고 `b`에만 있는 키는 비교되지 않는다 — 호출부가 "새로 들어온 쪽"을 `a`에 둔다).
 *
 * `excluded`가 두 질문을 가른다:
 *  - **같은 그랜트인가**(storage writer) — 토큰 축만 뺀다. `grantedAt`이 비교에 남아야
 *    같은 계정을 다시 연결한 뒤 뒤늦게 돌아온 옛 갱신을 걸러낸다(그걸 쓰면 방금 받은
 *    토큰이 소모된 값으로 덮여 다음 갱신이 invalid_grant가 된다).
 *  - **같은 계정인가**(store) — 토큰 축 + `grantedAt`을 뺀다. 재연동은 매번 새 그랜트라
 *    `grantedAt`이 항상 갈리는데, 그걸 신원으로 세면 "같은 계정 보전"이 영영 성립하지 않는다.
 *
 * **한쪽에만 있는 필드는 불일치로 보지 않는다.** 오탐의 비용이 미탐만큼 크기 때문 —
 * 정상 회전을 no-op으로 만들면 회전 토큰이 유실돼 다음 갱신이 invalid_grant가 되고,
 * 그게 곧 사용자에게 강제 재연동으로 보인다.
 *
 * 비-oauth(PAT·apiKey) auth는 토큰 필드가 `excluded`에 없어 토큰까지 신원으로 읽힌다 —
 * 토큰만 갈아끼워도 "다른 계정"이 되지만, 실패가 "지우는 쪽"이라 안전 방향이다.
 */
// auth 값이 전부 스칼라라는 전제 위에 있던 비교다. webhook의 headers가 배열이라 참조 비교로
// **늘 불일치**가 나왔고, 그러면 같은 폼을 다시 저장해도 매번 다른 계정으로 읽힌다. 지금
// 낙진이 없는 건 lastSubmitFields.webhook이 never라서일 뿐이라, 내용으로 비교한다.
// 순서는 의미가 있다 — 헤더 순서는 요청에 그대로 실린다.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    return [...keys].every((k) => sameValue(ao[k], bo[k]));
  }
  return false;
}

export function sameAuthIdentity(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  excluded: readonly string[],
): boolean {
  for (const key of Object.keys(a)) {
    if (excluded.includes(key)) continue;
    const av = a[key];
    const bv = b[key];
    if (av === undefined || bv === undefined) continue;
    if (!sameValue(av, bv)) return false;
  }
  return true;
}

let oauthStorageWriteTail: Promise<void> = Promise.resolve();

function serializeOAuthStorageWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = oauthStorageWriteTail.then(write, write);
  oauthStorageWriteTail = result.then(() => undefined, () => undefined);
  return result;
}

function writer<K extends OAuthAccountKey, A extends OAuthAuthOf<K>>(
  spec: OAuthWriteSpec<K, A>,
): (auth: A, connectionId?: string) => Promise<boolean> {
  return (auth, connectionId) => serializeOAuthStorageWrite(async () => {
    if (spec.account === "github" || spec.account === "linear") {
      return writeConnectionTokenOverlay(spec.account, auth as ConnectionAuth, connectionId, spec.fields, spec.keepIfAbsent);
    }
    const { raw, envelope } = await readEnvelope();
    const state = envelope?.state;
    const routeKey = spec.account === "github" || spec.account === "linear" ? spec.account as "github" | "linear" : undefined;
    const selectedId = routeKey ? connectionId ?? state?.selectedConnectionIds?.[routeKey] : undefined;
    const bucket = routeKey
      ? state?.connections?.[routeKey] as Array<{ id: string; account: { auth?: unknown } }> | undefined
      : undefined;
    const selectedRecord = selectedId ? bucket?.find((record) => record.id === selectedId) : undefined;
    const legacyAddressed = !!routeKey && !bucket && connectionId === `legacy-${routeKey}`;
    if (selectedId && !selectedRecord && !legacyAddressed) return false;
    if (selectedRecord && !selectedRecord.account.auth) return false;
    if (routeKey && !connectionId && bucket && bucket.length !== 1) return false;
    if (routeKey && !connectionId && bucket?.length === 1 && !selectedRecord) return false;
    const cur = selectedRecord
      ? selectedRecord.account.auth as AuthOf<K>
      : routeKey && bucket
        ? undefined
        : state?.accounts?.[spec.account]?.auth;
    // 판별자 비교는 타입이 봐야 한다 — cur를 Record<string, unknown>으로 눕히면 "oauth2"
    // 같은 오타가 컴파일을 통과하고 5개 writer가 통째로 무음 no-op이 된다.
    if (!cur || cur.kind !== "oauth") return false;
    // 재연동이 상시 경로가 되면서 생긴 창을 막는다: in-flight refresh가 재연동 뒤 resolve하면
    // 토큰 3필드만 구 계정 값으로 덮이고 신원 필드는 새 값으로 남아 `구 토큰 + 신 신원`이 된다.
    // GitLab self-managed면 A 인스턴스 토큰이 B의 baseUrl로 나간다.
    if (
      !sameAuthIdentity(
        auth as unknown as Record<string, unknown>,
        cur as unknown as Record<string, unknown>,
        grantIdentityExcluded(spec.account),
      )
    ) {
      return false;
    }
    const target = cur as A;
    for (const field of spec.fields) {
      target[field] = spec.keepIfAbsent?.includes(field)
        ? auth[field] ?? target[field]
        : auth[field];
    }
    if (selectedRecord) {
      selectedRecord.account.auth = target;
      if (routeKey && state?.selectedConnectionIds?.[routeKey] === selectedRecord.id) {
        if (!state.accounts || typeof state.accounts !== "object" || Array.isArray(state.accounts)) {
          state.accounts = {};
        }
        const accounts = state.accounts as Record<string, unknown>;
        const projection = accounts[routeKey];
        if (projection && typeof projection === "object" && !Array.isArray(projection)) {
          const projectedAuth = (projection as { auth?: unknown }).auth;
          if (projectedAuth && typeof projectedAuth === "object") {
            (projection as { auth?: unknown }).auth = target;
          } else {
            accounts[routeKey] = selectedRecord.account;
          }
        } else {
          accounts[routeKey] = selectedRecord.account;
        }
      }
    }
    const next = typeof raw === "string" ? JSON.stringify(envelope) : envelope;
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
    return true;
  });
}

export const readStoredAuth = reader(
  "jira",
  (envelope) => envelope.state?.jiraConfig?.auth,
);
export const readStoredGithubAuth = reader("github");
export const readStoredLinearAuth = reader("linear");

export type StoredConnectionAuthResolution<A, O = never> =
  | { status: "resolved"; connectionId: string; auth: A; organization?: O }
  | { status: "ambiguous" | "missing" | "unknown" };

type ConnectionPlatform = "github" | "linear";
type ConnectionAuth = GithubAuth | LinearAuth;
type ConnectionResolution = StoredConnectionAuthResolution<ConnectionAuth, { id: string; name: string }>;
interface TokenGrantBinding {
  platform: ConnectionPlatform;
  connectionId: string;
  grantedAt: number;
  viewerId?: string | number;
}

function resolveCanonicalConnectionAuth(
  platform: ConnectionPlatform,
  connectionId?: string,
): Promise<ConnectionResolution> {
  return readEnvelope().then(({ envelope }) => {
    const state = envelope?.state;
    const records = state?.connections?.[platform] as Array<{
      id: string; account: { auth?: ConnectionAuth }; organization?: { id: string; name: string };
    }> | undefined;
    if (connectionId) {
      const record = records?.find((item) => item.id === connectionId);
      if (record?.account.auth) return { status: "resolved", connectionId, auth: record.account.auth, ...(record.organization ? { organization: record.organization } : {}) };
      const legacyId = `legacy-${platform}`;
      const legacyAuth = state?.accounts?.[platform]?.auth as ConnectionAuth | undefined;
      if (!records && connectionId === legacyId && legacyAuth) return { status: "resolved", connectionId, auth: legacyAuth };
      return { status: "unknown" };
    }
    if (records) {
      if (records.length > 1) return { status: "ambiguous" };
      const selectedId = state?.selectedConnectionIds?.[platform];
      const record = selectedId ? records.find((item) => item.id === selectedId) : undefined;
      return record?.account.auth
        ? { status: "resolved", connectionId: record.id, auth: record.account.auth, ...(record.organization ? { organization: record.organization } : {}) }
        : { status: "missing" };
    }
    const auth = state?.accounts?.[platform]?.auth as ConnectionAuth | undefined;
    return auth ? { status: "resolved", connectionId: `legacy-${platform}`, auth } : { status: "missing" };
  });
}

function tokenGrantBinding(platform: ConnectionPlatform, connectionId: string, auth: ConnectionAuth): TokenGrantBinding | null {
  if (auth.kind !== "oauth" || !Number.isFinite(auth.grantedAt)) return null;
  if (platform === "github") {
    if (auth.viewerId != null && typeof auth.viewerId !== "number") return null;
    return { platform, connectionId, grantedAt: auth.grantedAt, ...(auth.viewerId != null ? { viewerId: auth.viewerId } : {}) };
  }
  if (auth.viewerId != null && typeof auth.viewerId !== "string") return null;
  return { platform, connectionId, grantedAt: auth.grantedAt, ...(auth.viewerId != null ? { viewerId: auth.viewerId } : {}) };
}

function sameTokenGrant(a: TokenGrantBinding | null, b: TokenGrantBinding | null): boolean {
  return !!a && !!b && a.platform === b.platform && a.connectionId === b.connectionId && a.grantedAt === b.grantedAt &&
    (a.viewerId == null || b.viewerId == null || a.viewerId === b.viewerId);
}

function parseTokenOverlays(raw: unknown): ConnectionTokenOverlays {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return {
    github: Array.isArray(source.github) ? source.github as GithubTokenOverlay[] : [],
    linear: Array.isArray(source.linear) ? source.linear as LinearTokenOverlay[] : [],
  };
}

async function readTokenOverlays(): Promise<ConnectionTokenOverlays> {
  const stored = await chrome.storage.local.get(CONNECTION_TOKEN_OVERLAY_STORAGE_KEY);
  return parseTokenOverlays(stored[CONNECTION_TOKEN_OVERLAY_STORAGE_KEY]);
}

function validOverlayBinding(platform: ConnectionPlatform, entry: unknown): entry is GithubTokenOverlay | LinearTokenOverlay {
  if (!entry || typeof entry !== "object") return false;
  const value = entry as Record<string, unknown>;
  if (value.platform !== platform || typeof value.connectionId !== "string" || !Number.isFinite(value.grantedAt)) return false;
  if (platform === "github" && value.viewerId != null && typeof value.viewerId !== "number") return false;
  if (platform === "linear" && value.viewerId != null && typeof value.viewerId !== "string") return false;
  if (!value.tokens || typeof value.tokens !== "object") return false;
  const tokens = value.tokens as Record<string, unknown>;
  if (typeof tokens.accessToken !== "string" || !tokens.accessToken) return false;
  if (platform === "github") {
    return typeof tokens.tokenType === "string" && typeof tokens.scope === "string" &&
      (tokens.refreshToken == null || typeof tokens.refreshToken === "string") &&
      (tokens.expiresAt == null || typeof tokens.expiresAt === "number");
  }
  return typeof tokens.refreshToken === "string" && typeof tokens.expiresAt === "number" && typeof tokens.scope === "string";
}

function overlayBinding(entry: GithubTokenOverlay | LinearTokenOverlay): TokenGrantBinding {
  return { platform: entry.platform, connectionId: entry.connectionId, grantedAt: entry.grantedAt, ...(entry.viewerId != null ? { viewerId: entry.viewerId } : {}) };
}

function applyTokenOverlay(auth: ConnectionAuth, entry: GithubTokenOverlay | LinearTokenOverlay): ConnectionAuth {
  if (entry.platform === "github") {
    return { ...auth, accessToken: entry.tokens.accessToken, tokenType: entry.tokens.tokenType, scope: entry.tokens.scope,
      ...(entry.tokens.refreshToken != null ? { refreshToken: entry.tokens.refreshToken } : {}),
      ...(entry.tokens.expiresAt != null ? { expiresAt: entry.tokens.expiresAt } : {}) } as GithubOAuthAuth;
  }
  return { ...auth, accessToken: entry.tokens.accessToken, refreshToken: entry.tokens.refreshToken, expiresAt: entry.tokens.expiresAt, scope: entry.tokens.scope } as LinearOAuthAuth;
}

async function resolveStoredConnectionAuth(platform: ConnectionPlatform, connectionId?: string): Promise<ConnectionResolution> {
  const initial = await resolveCanonicalConnectionAuth(platform, connectionId);
  if (initial.status !== "resolved") return initial;
  const overlays = await readTokenOverlays();
  // Re-read after the asynchronous overlay access. If the canonical grant changed, return only
  // the current canonical auth; never pair a stale envelope snapshot with an overlay.
  const current = await resolveCanonicalConnectionAuth(platform, connectionId);
  if (current.status !== "resolved") return current;
  const initialBinding = tokenGrantBinding(platform, initial.connectionId, initial.auth);
  const currentBinding = tokenGrantBinding(platform, current.connectionId, current.auth);
  if (!sameTokenGrant(initialBinding, currentBinding)) return current;
  const entry = overlays[platform]?.find((candidate) => validOverlayBinding(platform, candidate) && sameTokenGrant(overlayBinding(candidate), currentBinding));
  if (!entry) return current;
  return { ...current, auth: applyTokenOverlay(current.auth, entry) };
}

export async function resolveStoredGithubConnectionAuth(connectionId?: string): Promise<StoredConnectionAuthResolution<GithubAuth>> {
  const result = await resolveStoredConnectionAuth("github", connectionId);
  return result.status === "resolved" ? { status: "resolved", connectionId: result.connectionId, auth: result.auth as GithubAuth } : result;
}

export async function resolveStoredLinearConnectionAuth(connectionId?: string): Promise<StoredConnectionAuthResolution<LinearAuth, { id: string; name: string }>> {
  const result = await resolveStoredConnectionAuth("linear", connectionId);
  return result.status === "resolved"
    ? { status: "resolved", connectionId: result.connectionId, auth: result.auth as LinearAuth, ...(result.organization ? { organization: result.organization } : {}) }
    : result;
}

function liveGrantBindings(envelope: SettingsEnvelope | null): Record<ConnectionPlatform, Map<string, TokenGrantBinding>> {
  const live: Record<ConnectionPlatform, Map<string, TokenGrantBinding>> = { github: new Map(), linear: new Map() };
  for (const platform of ["github", "linear"] as const) {
    const records = envelope?.state?.connections?.[platform] as Array<{ id: string; account: { auth?: ConnectionAuth } }> | undefined;
    if (records) {
      for (const record of records) {
        const binding = record.account.auth && tokenGrantBinding(platform, record.id, record.account.auth);
        if (binding) live[platform].set(record.id, binding);
      }
      continue;
    }
    const auth = envelope?.state?.accounts?.[platform]?.auth as ConnectionAuth | undefined;
    const binding = auth && tokenGrantBinding(platform, `legacy-${platform}`, auth);
    if (binding) live[platform].set(`legacy-${platform}`, binding);
  }
  return live;
}

function overlaysContainAny(overlays: ConnectionTokenOverlays): boolean {
  return (overlays.github?.length ?? 0) > 0 || (overlays.linear?.length ?? 0) > 0;
}

async function removeOverlayBinding(platform: ConnectionPlatform, binding: TokenGrantBinding): Promise<void> {
  const overlays = await readTokenOverlays();
  const retained = (overlays[platform] ?? []).filter((entry) => !validOverlayBinding(platform, entry) || !sameTokenGrant(overlayBinding(entry), binding));
  const next = { ...overlays, [platform]: retained };
  if (!overlaysContainAny(next)) await chrome.storage.local.remove(CONNECTION_TOKEN_OVERLAY_STORAGE_KEY);
  else await chrome.storage.local.set({ [CONNECTION_TOKEN_OVERLAY_STORAGE_KEY]: next });
}

async function writeConnectionTokenOverlay(
  platform: ConnectionPlatform,
  incoming: ConnectionAuth,
  connectionId: string | undefined,
  fields: readonly string[],
  keepIfAbsent?: readonly string[],
): Promise<boolean> {
  const current = await resolveCanonicalConnectionAuth(platform, connectionId);
  if (current.status !== "resolved" || current.auth.kind !== "oauth" || incoming.kind !== "oauth") return false;
  const binding = tokenGrantBinding(platform, current.connectionId, current.auth);
  const requestedBinding = tokenGrantBinding(platform, current.connectionId, incoming);
  if (!sameTokenGrant(binding, requestedBinding)) return false;

  const overlays = await readTokenOverlays();
  const prior = (overlays[platform] ?? []).find((entry) => validOverlayBinding(platform, entry) && sameTokenGrant(overlayBinding(entry), binding));
  const currentTokens = current.auth as unknown as Record<string, unknown>;
  const incomingTokens = incoming as unknown as Record<string, unknown>;
  const priorTokens = prior?.tokens as unknown as Record<string, unknown> | undefined;
  const tokens: Record<string, unknown> = {};
  for (const field of fields) {
    const value = incomingTokens[field];
    const fallback = priorTokens?.[field] ?? currentTokens[field];
    const next = keepIfAbsent?.includes(field) ? value ?? fallback : value;
    if (next !== undefined) tokens[field] = next;
  }
  if (typeof tokens.accessToken !== "string" || !tokens.accessToken) return false;

  const entry = {
    platform,
    connectionId: current.connectionId,
    grantedAt: binding!.grantedAt,
    ...(binding!.viewerId != null ? { viewerId: binding!.viewerId } : {}),
    tokens,
  } as GithubTokenOverlay | LinearTokenOverlay;
  const retained = (overlays[platform] ?? []).filter((candidate) => candidate.connectionId !== current.connectionId);
  const next: ConnectionTokenOverlays = { ...overlays, [platform]: [...retained, entry] };
  await chrome.storage.local.set({ [CONNECTION_TOKEN_OVERLAY_STORAGE_KEY]: next });

  const latest = await resolveCanonicalConnectionAuth(platform, current.connectionId);
  const latestBinding = latest.status === "resolved" ? tokenGrantBinding(platform, latest.connectionId, latest.auth) : null;
  if (!sameTokenGrant(binding, latestBinding)) {
    await removeOverlayBinding(platform, binding!);
    return false;
  }
  return true;
}

/** Prune token secrets whose exact connection/grant no longer exists in canonical settings. */
export async function reconcileConnectionTokenOverlays(): Promise<void> {
  await serializeOAuthStorageWrite(async () => {
    const [{ envelope }, overlays] = await Promise.all([readEnvelope(), readTokenOverlays()]);
    const live = liveGrantBindings(envelope);
    const github = (overlays.github ?? []).filter((entry) => validOverlayBinding("github", entry) && sameTokenGrant(overlayBinding(entry), live.github.get(entry.connectionId) ?? null));
    const linear = (overlays.linear ?? []).filter((entry) => validOverlayBinding("linear", entry) && sameTokenGrant(overlayBinding(entry), live.linear.get(entry.connectionId) ?? null));
    const changed = github.length !== (overlays.github?.length ?? 0) || linear.length !== (overlays.linear?.length ?? 0);
    if (!changed) return;
    const next = { github, linear };
    if (!overlaysContainAny(next)) await chrome.storage.local.remove(CONNECTION_TOKEN_OVERLAY_STORAGE_KEY);
    else await chrome.storage.local.set({ [CONNECTION_TOKEN_OVERLAY_STORAGE_KEY]: next });
  });
}

export function setupConnectionTokenOverlayCleanup(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SETTINGS_STORAGE_KEY]) {
      void reconcileConnectionTokenOverlays().catch(() => {});
    }
  });
  void reconcileConnectionTokenOverlays().catch(() => {});
}

export const readStoredNotionAuth = reader("notion");
export const readStoredGitlabAuth = reader("gitlab");
export const readStoredAsanaAuth = reader("asana");
export const readStoredClickupAuth = reader("clickup");
export const readStoredSlackAuth = reader("slack");

// 플랫폼별 토큰 축의 **단일 출처**. writer의 갱신 whitelist이자 신원 판정의 여집합이고,
// store의 setAccount가 같은 값을 재사용한다(같은 계정 재연동이면 직전 제출값을 보전하는 판정).
// 두 곳에 따로 적으면 한쪽만 늘어난 채로 조용히 갈린다.
//
// notion·clickup·slack은 토큰이 회전하지 않아 writer가 없다(갱신 경로 자체가 없다). 그래도
// 신원 판정에는 자기 accessToken을 제외해야 하므로 여기 목록에 남긴다.
export const OAUTH_TOKEN_FIELDS = {
  jira: ["accessToken", "refreshToken", "expiresAt"],
  github: ["accessToken", "tokenType", "scope", "refreshToken", "expiresAt"],
  linear: ["accessToken", "refreshToken", "expiresAt", "scope"],
  notion: ["accessToken"],
  gitlab: ["accessToken", "refreshToken", "expiresAt", "scope"],
  asana: ["accessToken", "refreshToken", "expiresAt"],
  clickup: ["accessToken"],
  slack: ["accessToken"],
  // OAuth가 없다. 사용자 헤더는 시크릿이지만 토큰 축이 아니라 신원 축이다 —
  // 헤더를 바꾸면 다른 목적지일 수 있으므로 신원 비교에서 빼지 않는다.
  webhook: [],
} as const satisfies Record<AccountKey, readonly string[]>;

// 계정 신원 판정에서 뺄 축 = 토큰 축 + 그랜트 발급 시각. `grantedAt`은 재연동마다 새로
// 찍히므로(jira만 이 필드가 없다) 신원으로 세면 같은 계정 재연동이 영영 "다른 계정"이 된다.
// writer는 이걸 쓰지 않는다 — 거기선 그랜트가 갈렸는지가 곧 판정 대상이다.
export function accountIdentityExcluded(account: AccountKey): readonly string[] {
  return [...OAUTH_TOKEN_FIELDS[account], "grantedAt"];
}

// 같은 **그랜트**인지 볼 때 뺄 축. `grantedAt`을 남겨야 재연동 뒤 뒤늦게 돌아온 옛 갱신이
// 걸러진다. 이름을 붙이는 건 위 함수와 나란히 놓여 두 질문이 호출부에서 갈려 읽히게 하려는 것.
export function grantIdentityExcluded(account: AccountKey): readonly string[] {
  return OAUTH_TOKEN_FIELDS[account];
}

// auth **밖**(계정 필드)에 신원을 두는 플랫폼. 지금은 slack의 팀 하나뿐이지만(types/slack.ts;
// 나머지 7개는 cloudId·viewerLogin·baseUrl 등이 전부 auth 안에 있다) Partial로 두면 9번째
// 플랫폼이 같은 모양을 들고 와도 누락이 컴파일에도 테스트에도 안 걸린다 — 빈 배열을 명시해
// 컴파일러가 그 자리에서 결정을 강제하게 한다.
export const ACCOUNT_IDENTITY_FIELDS: Record<AccountKey, readonly string[]> = {
  jira: [],
  github: [],
  linear: [],
  notion: [],
  gitlab: [],
  asana: [],
  clickup: [],
  slack: ["teamId"],
  // 신원(엔드포인트 URL)이 auth 안에 있다.
  webhook: [],
};

export const writeStoredOAuthTokens = writer({
  account: "jira",
  fields: OAUTH_TOKEN_FIELDS.jira,
});
export const writeStoredGithubOAuthTokens = writer({
  account: "github",
  fields: OAUTH_TOKEN_FIELDS.github,
  keepIfAbsent: ["refreshToken", "expiresAt"],
});
export const writeStoredLinearOAuthTokens = writer({
  account: "linear",
  fields: OAUTH_TOKEN_FIELDS.linear,
});
export const writeStoredGitlabOAuthTokens = writer({
  account: "gitlab",
  fields: OAUTH_TOKEN_FIELDS.gitlab,
});
export const writeStoredAsanaOAuthTokens = writer({
  account: "asana",
  fields: OAUTH_TOKEN_FIELDS.asana,
});
