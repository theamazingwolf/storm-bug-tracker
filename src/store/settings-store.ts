import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { JiraAuth } from "@/types/jira";
import type {
  Accounts,
  JiraAccount,
  JiraLastSubmitFields,
  LastSubmitFieldsByPlatform,
  PlatformId,
} from "@/types/platform";
import type { GithubAccount } from "@/types/github";
import type { LinearAccount } from "@/types/linear";
import type { NotionAccount } from "@/types/notion";
import type { GitlabAccount } from "@/types/gitlab";
import type { AsanaAccount } from "@/types/asana";
import type { ClickupAccount } from "@/types/clickup";
import type { SlackAccount } from "@/types/slack";
import type { WebhookAccount } from "@/types/webhook";
import type {
  AddLinearConnectionOptions,
  ConnectionRecords,
  ConnectionUpdate,
  DestinationProfile,
  GithubConnection,
  LinearConnection,
  RoutablePlatform,
  SelectedConnectionIds,
  WebsiteOriginMapping,
} from "@/types/connection";
import {
  ACCOUNT_IDENTITY_FIELDS,
  SETTINGS_STORAGE_KEY,
  accountIdentityExcluded,
  sameAuthIdentity,
} from "@/lib/settings-storage";
import { chromeLocalStorage } from "./chrome-storage";

// v6: notion 플랫폼 추가 (accounts.notion / lastSubmitFields.notion / lastSubmittedPlatform="notion").
// v7: gitlab 플랫폼 추가. 새 필드는 모두 optional이라 v6→v7 데이터 마이그레이션 불필요 — 버전 마커만 bump.
// v8: asana 플랫폼 추가. 동일하게 새 필드 모두 optional이라 버전 마커만 bump.
// v9: clickup 플랫폼 추가. 새 필드 모두 optional이라 버전 마커만 bump.
// v10: slack 플랫폼 추가. 동일하게 새 필드 모두 optional이라 버전 마커만 bump.
// v11: jira 연결 이슈 단일(relatesKey/relatesLabel)→복수(relates[{key,label}]). 직전 제출값 이관(migrateToV11).
// v12: webhook 플랫폼 추가. 새 필드는 optional이라 이관할 데이터가 없지만, url 없는 webhook
// 계정은 제출이 불가능한 껍데기라 migrateToV12가 걷어낸다(방어 — 정상 경로로는 안 생긴다).
// v13: GitHub/Linear connection records, selected compatibility projections, destinations, and origins.
export const SETTINGS_STORE_VERSION = 13;

interface SettingsState {
  accounts: Accounts;
  connections: ConnectionRecords;
  selectedConnectionIds: SelectedConnectionIds;
  destinationProfiles: DestinationProfile[];
  websiteOriginMappings: WebsiteOriginMapping[];
  addConnection(platform: "github", account: GithubAccount): string;
  addConnection(platform: "linear", account: LinearAccount, options?: AddLinearConnectionOptions): string;
  selectConnection: (platform: RoutablePlatform, connectionId: string | undefined) => void;
  updateConnection: <P extends RoutablePlatform>(platform: P, connectionId: string, patch: ConnectionUpdate<P>) => void;
  removeConnection: (platform: RoutablePlatform, connectionId: string) => void;
  getConnection(platform: "github", connectionId: string): GithubConnection | undefined;
  getConnection(platform: "linear", connectionId: string): LinearConnection | undefined;
  setConnectionLastSubmitFields: <P extends RoutablePlatform>(platform: P, connectionId: string, fields: P extends "github" ? import("@/types/platform").GithubLastSubmitFields : import("@/types/platform").LinearLastSubmitFields) => void;
  lastSubmitFields: LastSubmitFieldsByPlatform;
  lastSubmittedPlatform?: PlatformId;
  titlePrefix: string;
  setAccount: <P extends PlatformId>(platform: P, account: Accounts[P]) => void;
  removeAccount: (platform: PlatformId) => void;
  removeAllAccounts: () => void;
  updateJiraAccount: (
    patch: Partial<Omit<JiraAccount, "platform" | "connectedAt">>,
  ) => void;
  updateGithubAccount: (
    patch: Partial<Omit<GithubAccount, "platform" | "connectedAt">>,
  ) => void;
  updateLinearAccount: (
    patch: Partial<Omit<LinearAccount, "platform" | "connectedAt">>,
  ) => void;
  updateNotionAccount: (
    patch: Partial<Omit<NotionAccount, "platform" | "connectedAt">>,
  ) => void;
  updateGitlabAccount: (
    patch: Partial<Omit<GitlabAccount, "platform" | "connectedAt">>,
  ) => void;
  updateAsanaAccount: (
    patch: Partial<Omit<AsanaAccount, "platform" | "connectedAt">>,
  ) => void;
  updateClickupAccount: (
    patch: Partial<Omit<ClickupAccount, "platform" | "connectedAt">>,
  ) => void;
  updateSlackAccount: (
    patch: Partial<Omit<SlackAccount, "platform" | "connectedAt">>,
  ) => void;
  updateWebhookAccount: (
    patch: Partial<Omit<WebhookAccount, "platform" | "connectedAt">>,
  ) => void;
  setLastSubmitFields: <P extends PlatformId>(
    platform: P,
    fields: NonNullable<LastSubmitFieldsByPlatform[P]>,
  ) => void;
  setLastSubmittedPlatform: (platform: PlatformId) => void;
  setTitlePrefix: (prefix: string) => void;
}

interface LegacyV1 {
  jiraConfig?: {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    projectKey?: string;
    issueTypeId?: string;
    issueTypeName?: string;
    titlePrefix?: string;
  };
}

interface LegacyV2 {
  jiraConfig?: {
    auth?: JiraAuth;
    projectKey?: string;
    issueTypeId?: string;
    issueTypeName?: string;
    titlePrefix?: string;
  } | null;
  lastSubmitFields?: {
    projectKey?: string;
    assigneeId?: string;
    assigneeName?: string;
    priorityId?: string;
    priorityName?: string;
    parentKey?: string;
    parentLabel?: string;
    relatesKey?: string;
    relatesLabel?: string;
  };
}

type V3Shape = Pick<SettingsState, "accounts" | "lastSubmitFields">;

export function migrateV1ToV2(legacy: LegacyV1): LegacyV2 {
  const j = legacy.jiraConfig;
  if (!j?.baseUrl || !j.email || !j.apiToken) return { jiraConfig: null };
  return {
    jiraConfig: {
      auth: {
        kind: "apiKey",
        baseUrl: j.baseUrl,
        email: j.email,
        apiToken: j.apiToken,
      },
      projectKey: j.projectKey,
      issueTypeId: j.issueTypeId,
      issueTypeName: j.issueTypeName,
      titlePrefix: j.titlePrefix,
    },
  };
}

export function migrateV2ToV3(legacy: LegacyV2): V3Shape {
  const accounts: Accounts = {};
  const j = legacy.jiraConfig;
  if (j?.auth) {
    accounts.jira = {
      platform: "jira",
      connectedAt: Date.now(),
      auth: j.auth,
      projectKey: j.projectKey,
      issueTypeId: j.issueTypeId,
      issueTypeName: j.issueTypeName,
      ...(j.titlePrefix ? { titlePrefix: j.titlePrefix } : {}),
    } as JiraAccount;
  }
  const lastSubmitFields: LastSubmitFieldsByPlatform = {};
  if (legacy.lastSubmitFields && Object.keys(legacy.lastSubmitFields).length) {
    lastSubmitFields.jira = { ...legacy.lastSubmitFields };
  }
  return { accounts, lastSubmitFields };
}

function readTitlePrefix(account: unknown): string | undefined {
  const tp = (account as Record<string, unknown> | undefined)?.titlePrefix;
  return typeof tp === "string" ? tp : undefined;
}

export function migrateToV5(state: V3Shape): V3Shape & { titlePrefix: string } {
  const a = state.accounts;
  const prefix =
    readTitlePrefix(a.jira) ?? readTitlePrefix(a.github) ?? readTitlePrefix(a.linear) ?? "";
  return { ...state, titlePrefix: prefix };
}

// v11: jira 연결 이슈 단일→복수. 직전 제출값의 relatesKey/relatesLabel을 relates[] 첫 항목으로 이관.
// v10 데이터는 jira에 옛 relatesKey/relatesLabel을 들고 오므로 입력 타입에서 그 키를 허용한다.
type JiraLastSubmitPreV11 = JiraLastSubmitFields & {
  relatesKey?: string;
  relatesLabel?: string;
};
type PreV11Shape = {
  accounts: V3Shape["accounts"];
  lastSubmitFields: Omit<V3Shape["lastSubmitFields"], "jira"> & {
    jira?: JiraLastSubmitPreV11;
  };
};

export function migrateToV11(state: PreV11Shape): V3Shape {
  const lastSubmitFields = state.lastSubmitFields ?? {};
  const jira = lastSubmitFields.jira;
  if (!jira?.relatesKey) return { ...state, lastSubmitFields } as V3Shape;
  const { relatesKey, relatesLabel, ...rest } = jira;
  return {
    ...state,
    lastSubmitFields: {
      ...lastSubmitFields,
      jira: { ...rest, relates: [{ key: relatesKey, label: relatesLabel ?? relatesKey }] },
    },
  } as V3Shape;
}

// url 없는 webhook 계정은 제출이 불가능한 껍데기다. 정상 경로로는 생기지 않지만
// (연결 테스트를 통과해야 저장된다) 그대로 두면 탭만 뜨고 제출이 매번 실패한다.
export function migrateToV12(state: V3Shape): V3Shape {
  const accounts = (state.accounts ?? {}) as Record<string, unknown>;
  const wh = accounts.webhook as { auth?: { url?: unknown } } | undefined;
  if (!wh) return state;
  if (typeof wh.auth?.url === "string" && wh.auth.url !== "") return state;
  const { webhook: _drop, ...rest } = accounts;
  return { ...state, accounts: rest } as V3Shape;
}

export type SettingsV13Shape = V3Shape & {
  connections: ConnectionRecords;
  selectedConnectionIds: SelectedConnectionIds;
  destinationProfiles: DestinationProfile[];
  websiteOriginMappings: WebsiteOriginMapping[];
};

export function migrateToV13(state: Partial<SettingsV13Shape> & V3Shape): SettingsV13Shape {
  const existing = state.connections;
  const connections: ConnectionRecords = {
    github: existing?.github ?? (state.accounts.github ? [{
      id: "legacy-github", platform: "github", account: state.accounts.github,
      ...(state.lastSubmitFields?.github ? { lastSubmitFields: state.lastSubmitFields.github } : {}),
    }] : []),
    linear: existing?.linear ?? (state.accounts.linear ? [{
      id: "legacy-linear", platform: "linear", account: state.accounts.linear,
      ...(state.lastSubmitFields?.linear ? { lastSubmitFields: state.lastSubmitFields.linear } : {}),
    }] : []),
  };
  const selectedConnectionIds = state.selectedConnectionIds ?? {
    ...(state.accounts.github ? { github: connections.github[0]?.id } : {}),
    ...(state.accounts.linear ? { linear: connections.linear[0]?.id } : {}),
  };
  return {
    ...state,
    accounts: state.accounts ?? {},
    lastSubmitFields: state.lastSubmitFields ?? {},
    connections,
    selectedConnectionIds,
    destinationProfiles: state.destinationProfiles ?? [],
    websiteOriginMappings: state.websiteOriginMappings ?? [],
  };
}

function newConnectionId(platform: RoutablePlatform): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("Secure random connection IDs are unavailable");
  return `${platform}-${id}`;
}

export function isV3Shape(state: unknown): state is V3Shape {
  if (!state || typeof state !== "object") return false;
  return "accounts" in state;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set): SettingsState => ({
      accounts: {},
      connections: { github: [], linear: [] },
      selectedConnectionIds: {},
      destinationProfiles: [],
      websiteOriginMappings: [],
      lastSubmitFields: {},
      titlePrefix: "",
      addConnection: ((platform: RoutablePlatform, account: GithubAccount | LinearAccount, options?: AddLinearConnectionOptions) => {
        const id = newConnectionId(platform);
        set((s) => {
          const newlySelected = !s.selectedConnectionIds[platform];
          const selectedConnectionIds = newlySelected ? { ...s.selectedConnectionIds, [platform]: id } : s.selectedConnectionIds;
          if (platform === "github") {
            const record: GithubConnection = { id, platform, account: account as GithubAccount };
            return {
              connections: { ...s.connections, github: [...s.connections.github, record] },
              selectedConnectionIds,
              accounts: newlySelected ? { ...s.accounts, github: record.account } : s.accounts,
            };
          }
          const record: LinearConnection = { id, platform, account: account as LinearAccount, ...(options?.organization ? { organization: options.organization } : {}) };
          return {
            connections: { ...s.connections, linear: [...s.connections.linear, record] },
            selectedConnectionIds,
            accounts: newlySelected ? { ...s.accounts, linear: record.account } : s.accounts,
          };
        });
        return id;
      }) as SettingsState["addConnection"],
      selectConnection: (platform, connectionId) => set((s) => {
        if (platform === "github") {
          const record = connectionId ? s.connections.github.find((item) => item.id === connectionId) : undefined;
          if (connectionId && !record) return s;
          const selectedConnectionIds = { ...s.selectedConnectionIds };
          if (connectionId) selectedConnectionIds.github = connectionId;
          else delete selectedConnectionIds.github;
          const accounts = { ...s.accounts };
          if (record) accounts.github = record.account;
          else delete accounts.github;
          const lastSubmitFields = { ...s.lastSubmitFields };
          if (record?.lastSubmitFields) lastSubmitFields.github = record.lastSubmitFields;
          else delete lastSubmitFields.github;
          return { selectedConnectionIds, accounts, lastSubmitFields };
        }
        const record = connectionId ? s.connections.linear.find((item) => item.id === connectionId) : undefined;
        if (connectionId && !record) return s;
        const selectedConnectionIds = { ...s.selectedConnectionIds };
        if (connectionId) selectedConnectionIds.linear = connectionId;
        else delete selectedConnectionIds.linear;
        const accounts = { ...s.accounts };
        if (record) accounts.linear = record.account;
        else delete accounts.linear;
        const lastSubmitFields = { ...s.lastSubmitFields };
        if (record?.lastSubmitFields) lastSubmitFields.linear = record.lastSubmitFields;
        else delete lastSubmitFields.linear;
        return { selectedConnectionIds, accounts, lastSubmitFields };
      }),
      updateConnection: (platform, connectionId, patch) => set((s) => {
        if (platform === "github") {
          if (!s.connections.github.some((record) => record.id === connectionId)) return s;
          const typedPatch = patch as ConnectionUpdate<"github">;
          const github = s.connections.github.map((record) => record.id === connectionId ? { ...record, account: { ...record.account, ...(typedPatch.defaults ? { defaults: typedPatch.defaults } : {}) }, ...(typedPatch.lastSubmitFields ? { lastSubmitFields: typedPatch.lastSubmitFields } : {}) } : record);
          const selected = s.selectedConnectionIds.github === connectionId;
          return { connections: { ...s.connections, github }, ...(selected ? { accounts: { ...s.accounts, github: github.find((r) => r.id === connectionId)!.account }, ...(typedPatch.lastSubmitFields ? { lastSubmitFields: { ...s.lastSubmitFields, github: typedPatch.lastSubmitFields } } : {}) } : {}) };
        }
        if (!s.connections.linear.some((record) => record.id === connectionId)) return s;
        const typedPatch = patch as ConnectionUpdate<"linear">;
        const linear = s.connections.linear.map((record) => record.id === connectionId ? { ...record, account: { ...record.account, ...(typedPatch.defaults ? { defaults: typedPatch.defaults } : {}) }, ...(typedPatch.lastSubmitFields ? { lastSubmitFields: typedPatch.lastSubmitFields } : {}) } : record);
        const selected = s.selectedConnectionIds.linear === connectionId;
        return { connections: { ...s.connections, linear }, ...(selected ? { accounts: { ...s.accounts, linear: linear.find((r) => r.id === connectionId)!.account }, ...(typedPatch.lastSubmitFields ? { lastSubmitFields: { ...s.lastSubmitFields, linear: typedPatch.lastSubmitFields } } : {}) } : {}) };
      }),
      removeConnection: (platform, connectionId) => set((s) => {
        const connections = { ...s.connections, [platform]: s.connections[platform].filter((record) => record.id !== connectionId) };
        if (connections[platform].length === s.connections[platform].length) return s;
        const removedDestinationIds = new Set(s.destinationProfiles.filter((profile) => profile.platform === platform && profile.connectionId === connectionId).map((profile) => profile.id));
        const destinationProfiles = s.destinationProfiles.filter((profile) => !removedDestinationIds.has(profile.id));
        const websiteOriginMappings = s.websiteOriginMappings.filter((mapping) => !removedDestinationIds.has(mapping.destinationId));
        if (s.selectedConnectionIds[platform] !== connectionId) return { connections, destinationProfiles, websiteOriginMappings };
        const selectedConnectionIds = { ...s.selectedConnectionIds };
        delete selectedConnectionIds[platform];
        const accounts = { ...s.accounts };
        delete accounts[platform];
        const lastSubmitFields = { ...s.lastSubmitFields };
        delete lastSubmitFields[platform];
        return { connections, destinationProfiles, websiteOriginMappings, selectedConnectionIds, accounts, lastSubmitFields };
      }),
      getConnection: ((platform: RoutablePlatform, connectionId: string) => useSettingsStore.getState().connections[platform].find((record) => record.id === connectionId)) as SettingsState["getConnection"],
      setConnectionLastSubmitFields: ((platform: RoutablePlatform, connectionId: string, fields: import("@/types/platform").GithubLastSubmitFields | import("@/types/platform").LinearLastSubmitFields) => set((s) => {
        if (platform === "github") {
          const typedFields = fields as import("@/types/platform").GithubLastSubmitFields;
          if (!s.connections.github.some((record) => record.id === connectionId)) return s;
          const connections = { ...s.connections, github: s.connections.github.map((record) => record.id === connectionId ? { ...record, lastSubmitFields: typedFields } : record) };
          const lastSubmitFields = s.selectedConnectionIds.github === connectionId ? { ...s.lastSubmitFields, github: typedFields } : s.lastSubmitFields;
          return { connections, lastSubmitFields };
        }
        const typedFields = fields as import("@/types/platform").LinearLastSubmitFields;
        if (!s.connections.linear.some((record) => record.id === connectionId)) return s;
        const connections = { ...s.connections, linear: s.connections.linear.map((record) => record.id === connectionId ? { ...record, lastSubmitFields: typedFields } : record) };
        const lastSubmitFields = s.selectedConnectionIds.linear === connectionId ? { ...s.lastSubmitFields, linear: typedFields } : s.lastSubmitFields;
        return { connections, lastSubmitFields };
      })) as SettingsState["setConnectionLastSubmitFields"],
      // **다른** 계정이 들어오면 그 플랫폼의 직전 제출값을 버린다. 남기면 이전 계정의
      // 목적지(owner/repo·workspace 등)가 새 자격증명에 prefill되고, 그 계정이 그 목적지에
      // 접근 권한을 가지면 캡처 데이터가 이전 조직으로 나간다. 계정 신원 게이트를 가진 건
      // Jira(lib/initialJiraFields의 siteId 대조)뿐이라 나머지 7개엔 방어가 없다.
      // 해제→연결 시절엔 removeAccount가 이걸 지워줘서 드러나지 않던 축이다.
      //
      // 반대로 **같은** 계정이면 남긴다 — 토큰 만료 재연동은 계정 변경이 아니고, 거기서
      // 설정을 초기화하면 만료 복구가 매번 재입력을 강요한다. 신원 판정은 storage writer와
      // 같은 술어·같은 토큰 축을 쓴다.
      setAccount: (platform, account) =>
        set((s) => {
          if (platform === "github") {
            const id = s.selectedConnectionIds.github ?? newConnectionId("github");
            const prior = s.connections.github.find((record) => record.id === id);
            const nextAccount = account as GithubAccount;
            const prevAuth = (s.accounts.github?.auth ?? prior?.account.auth) as unknown as Record<string, unknown> | undefined;
            const sameAccount = !!prevAuth && sameAuthIdentity(nextAccount.auth as unknown as Record<string, unknown>, prevAuth, accountIdentityExcluded("github"));
            const oldFields = s.lastSubmitFields.github ?? prior?.lastSubmitFields;
            const record: GithubConnection = { id, platform: "github", account: nextAccount, ...(sameAccount && oldFields ? { lastSubmitFields: oldFields } : {}) };
            const lastSubmitFields = { ...s.lastSubmitFields };
            if (!sameAccount) delete lastSubmitFields.github;
            return {
              accounts: { ...s.accounts, github: nextAccount },
              connections: { ...s.connections, github: prior ? s.connections.github.map((item) => item.id === id ? record : item) : [...s.connections.github, record] },
              selectedConnectionIds: { ...s.selectedConnectionIds, github: id },
              lastSubmitFields,
            };
          }
          if (platform === "linear") {
            const id = s.selectedConnectionIds.linear ?? newConnectionId("linear");
            const prior = s.connections.linear.find((record) => record.id === id);
            const nextAccount = account as LinearAccount;
            const prevAuth = (s.accounts.linear?.auth ?? prior?.account.auth) as unknown as Record<string, unknown> | undefined;
            const sameAccount = !!prevAuth && sameAuthIdentity(nextAccount.auth as unknown as Record<string, unknown>, prevAuth, accountIdentityExcluded("linear"));
            const oldFields = s.lastSubmitFields.linear ?? prior?.lastSubmitFields;
            const record: LinearConnection = { id, platform: "linear", account: nextAccount, ...(prior?.organization ? { organization: prior.organization } : {}), ...(sameAccount && oldFields ? { lastSubmitFields: oldFields } : {}) };
            const lastSubmitFields = { ...s.lastSubmitFields };
            if (!sameAccount) delete lastSubmitFields.linear;
            return {
              accounts: { ...s.accounts, linear: nextAccount },
              connections: { ...s.connections, linear: prior ? s.connections.linear.map((item) => item.id === id ? record : item) : [...s.connections.linear, record] },
              selectedConnectionIds: { ...s.selectedConnectionIds, linear: id },
              lastSubmitFields,
            };
          }
          const prevAccount = s.accounts[platform] as
            | Record<string, unknown>
            | undefined;
          const nextAccount = account as Record<string, unknown> | undefined;
          const prev = prevAccount?.auth as Record<string, unknown> | undefined;
          const next = nextAccount?.auth as Record<string, unknown> | undefined;
          // 계정 신원은 대개 auth 안에 있지만(cloudId·baseUrl·viewer*) slack만 팀이
          // 계정 필드다 — 그것까지 봐야 다른 워크스페이스로 재연동한 걸 가른다.
          const sameAccount =
            !!prev &&
            !!next &&
            sameAuthIdentity(next, prev, accountIdentityExcluded(platform)) &&
            (ACCOUNT_IDENTITY_FIELDS[platform] ?? []).every(
              (key) => nextAccount?.[key] === prevAccount?.[key],
            );
          const nextFields = { ...s.lastSubmitFields };
          if (!sameAccount) delete nextFields[platform];
          return {
            accounts: { ...s.accounts, [platform]: account },
            lastSubmitFields: nextFields,
          };
        }),
      removeAccount: (platform) =>
        set((s) => {
          const next = { ...s.accounts };
          delete next[platform];
          if (platform === "github" || platform === "linear") {
            const connections = { ...s.connections, [platform]: [] };
            const selectedConnectionIds = { ...s.selectedConnectionIds };
            delete selectedConnectionIds[platform];
            const nextFields = { ...s.lastSubmitFields };
            delete nextFields[platform];
            const removedDestinationIds = new Set(s.destinationProfiles.filter((profile) => profile.platform === platform).map((profile) => profile.id));
            return {
              accounts: next, connections, selectedConnectionIds, lastSubmitFields: nextFields,
              destinationProfiles: s.destinationProfiles.filter((profile) => !removedDestinationIds.has(profile.id)),
              websiteOriginMappings: s.websiteOriginMappings.filter((mapping) => !removedDestinationIds.has(mapping.destinationId)),
            };
          }
          // 연동 해제 시 해당 플랫폼의 prefill(issueType·assignee 등)도 함께 정리.
          const nextFields = { ...s.lastSubmitFields };
          delete nextFields[platform];
          return { accounts: next, lastSubmitFields: nextFields };
        }),
      removeAllAccounts: () => set({
        accounts: {},
        connections: { github: [], linear: [] },
        selectedConnectionIds: {},
        destinationProfiles: [],
        websiteOriginMappings: [],
        lastSubmitFields: {},
      }),
      updateJiraAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.jira;
          if (!cur) return s;
          return { accounts: { ...s.accounts, jira: { ...cur, ...patch } } };
        }),
      updateGithubAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.github;
          if (!cur) return s;
          const account = { ...cur, ...patch };
          const id = s.selectedConnectionIds.github;
          const connections = id ? { ...s.connections, github: s.connections.github.map((item) => item.id === id ? { ...item, account } : item) } : s.connections;
          return { accounts: { ...s.accounts, github: account }, connections };
        }),
      updateLinearAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.linear;
          if (!cur) return s;
          const account = { ...cur, ...patch };
          const id = s.selectedConnectionIds.linear;
          const connections = id ? { ...s.connections, linear: s.connections.linear.map((item) => item.id === id ? { ...item, account } : item) } : s.connections;
          return { accounts: { ...s.accounts, linear: account }, connections };
        }),
      updateNotionAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.notion;
          if (!cur) return s;
          return { accounts: { ...s.accounts, notion: { ...cur, ...patch } } };
        }),
      updateGitlabAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.gitlab;
          if (!cur) return s;
          return { accounts: { ...s.accounts, gitlab: { ...cur, ...patch } } };
        }),
      updateAsanaAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.asana;
          if (!cur) return s;
          return { accounts: { ...s.accounts, asana: { ...cur, ...patch } } };
        }),
      updateClickupAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.clickup;
          if (!cur) return s;
          return { accounts: { ...s.accounts, clickup: { ...cur, ...patch } } };
        }),
      updateSlackAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.slack;
          if (!cur) return s;
          return { accounts: { ...s.accounts, slack: { ...cur, ...patch } } };
        }),
      updateWebhookAccount: (patch) =>
        set((s) => {
          const cur = s.accounts.webhook;
          if (!cur) return s;
          return { accounts: { ...s.accounts, webhook: { ...cur, ...patch } } };
        }),
      setLastSubmitFields: (platform, fields) =>
        set((s) => {
          const lastSubmitFields = { ...s.lastSubmitFields, [platform]: fields };
          if (platform === "github") {
            const id = s.selectedConnectionIds.github;
            const connections = id ? { ...s.connections, github: s.connections.github.map((record) => record.id === id ? { ...record, lastSubmitFields: fields as import("@/types/platform").GithubLastSubmitFields } : record) } : s.connections;
            return { lastSubmitFields, connections };
          }
          if (platform === "linear") {
            const id = s.selectedConnectionIds.linear;
            const connections = id ? { ...s.connections, linear: s.connections.linear.map((record) => record.id === id ? { ...record, lastSubmitFields: fields as import("@/types/platform").LinearLastSubmitFields } : record) } : s.connections;
            return { lastSubmitFields, connections };
          }
          return { lastSubmitFields };
        }),
      setLastSubmittedPlatform: (platform) =>
        set({ lastSubmittedPlatform: platform }),
      setTitlePrefix: (prefix) => set({ titlePrefix: prefix }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: SETTINGS_STORE_VERSION,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: (persistedState, version) => {
        let state: Record<string, unknown>;
        if (isV3Shape(persistedState)) {
          state = persistedState as Record<string, unknown>;
        } else {
          let v2: LegacyV2;
          if (version >= 2) {
            v2 = (persistedState as LegacyV2) ?? {};
          } else {
            v2 = migrateV1ToV2((persistedState as LegacyV1) ?? {});
          }
          state = migrateV2ToV3(v2) as Record<string, unknown>;
        }
        if (version < 5) {
          state = migrateToV5(state as V3Shape);
        }
        if (version < 11) {
          state = migrateToV11(state as V3Shape) as Record<string, unknown>;
        }
        if (version < 12) {
          state = migrateToV12(state as V3Shape) as Record<string, unknown>;
        }
        if (version < 13) {
          state = migrateToV13(state as V3Shape) as unknown as Record<string, unknown>;
        }
        return state as unknown as SettingsState;
      },
    },
  ),
);

export function isJiraAccountComplete(
  acc: JiraAccount | undefined,
): acc is JiraAccount & { projectKey: string } {
  return !!acc?.auth && !!acc.projectKey;
}

export function jiraSiteId(auth: JiraAuth): string {
  if (auth.kind === "oauth") return auth.cloudId;
  try {
    return new URL(auth.baseUrl).hostname;
  } catch {
    return auth.baseUrl;
  }
}

export function jiraHostLabel(auth: JiraAuth): string {
  const url = auth.kind === "apiKey" ? auth.baseUrl : auth.siteUrl;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// 새 플랫폼이 PlatformId에 추가되면 키 누락으로 컴파일 에러 — 폴백 목록이 조용히 빠지는 걸 막는다.
const PLATFORM_FALLBACK_RANK = {
  jira: 0, github: 1, linear: 2, gitlab: 3,
  notion: 4, asana: 5, clickup: 6, slack: 7, webhook: 8,
} as const satisfies Record<PlatformId, number>;

const PLATFORM_FALLBACK_ORDER = (Object.keys(PLATFORM_FALLBACK_RANK) as PlatformId[])
  .sort((a, b) => PLATFORM_FALLBACK_RANK[a] - PLATFORM_FALLBACK_RANK[b]);

// 다이얼로그가 열릴 때 어느 플랫폼 탭을 default로 보여줄지 결정.
// 1) lastSubmittedPlatform이 여전히 연결돼 있으면 그것
// 2) 그 외엔 jira → github 순으로 처음 연결된 것
// 3) 아무것도 연결 안 됐으면 null (다이얼로그 진입 자체를 막아야 함)
export function pickInitialPlatform(
  accounts: Accounts,
  lastSubmittedPlatform: PlatformId | undefined,
): PlatformId | null {
  if (lastSubmittedPlatform && accounts[lastSubmittedPlatform]) {
    return lastSubmittedPlatform;
  }
  for (const p of PLATFORM_FALLBACK_ORDER) {
    if (accounts[p]) return p;
  }
  return null;
}

export function connectedPlatforms(accounts: Accounts): PlatformId[] {
  return PLATFORM_FALLBACK_ORDER.filter((p) => !!accounts[p]);
}

export function isLinearAccountComplete(
  acc: LinearAccount | undefined,
): boolean {
  return !!acc?.auth;
}

export function isNotionAccountComplete(
  acc: NotionAccount | undefined,
): boolean {
  return !!acc?.auth;
}
