import { nativeChatGptBridge } from "./nativeChatGptBridge";
import {
  isRecord,
  NativeChatGptError,
  utf8Bytes,
} from "./nativeChatGptProtocol";
import type {
  NativeChatGptModel,
  NativeChatGptProfile,
  NativeChatGptStatus,
} from "@/store/native-chatgpt-ui-store";

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

function parseStatus(value: unknown): NativeChatGptStatus {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["connected", "activeProfileId", "profile", "planEnabled", "imageInput"]) ||
    typeof value.connected !== "boolean" ||
    !(value.activeProfileId === null || validId(value.activeProfileId)) ||
    !(value.profile === null || isRecord(value.profile)) ||
    typeof value.planEnabled !== "boolean" ||
    value.imageInput !== "unsupported"
  ) {
    throw new NativeChatGptError("protocol_error");
  }
  return {
    connected: value.connected,
    activeProfileId: value.activeProfileId,
    planEnabled: value.planEnabled,
    imageInput: "unsupported",
  };
}

function parseProfiles(value: unknown): NativeChatGptProfile[] {
  if (!isRecord(value) || !hasOnlyKeys(value, ["profiles"]) || !Array.isArray(value.profiles)) {
    throw new NativeChatGptError("protocol_error");
  }
  return value.profiles.map((profile) => {
    if (
      !isRecord(profile) ||
      !hasOnlyKeys(profile, ["id", "email", "subject", "clientId", "signedIn", "planEnabled"]) ||
      !validId(profile.id) ||
      !(profile.email === null || (typeof profile.email === "string" && profile.email.length <= 320)) ||
      typeof profile.subject !== "string" || profile.subject.length > 512 ||
      typeof profile.clientId !== "string" || profile.clientId.length > 256 ||
      typeof profile.signedIn !== "boolean" ||
      typeof profile.planEnabled !== "boolean"
    ) {
      throw new NativeChatGptError("protocol_error");
    }
    // subject and clientId are validated but deliberately not retained or displayed.
    return {
      id: profile.id,
      email: profile.email,
      signedIn: profile.signedIn,
      planEnabled: profile.planEnabled,
    };
  });
}

function parseModels(value: unknown, expectedProfileId: string): NativeChatGptModel[] {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["profileId", "models"]) ||
    value.profileId !== expectedProfileId ||
    !Array.isArray(value.models) ||
    value.models.length > 500
  ) {
    throw new NativeChatGptError("protocol_error");
  }
  return value.models.map((model) => {
    if (
      !isRecord(model) ||
      !hasOnlyKeys(model, ["slug", "displayName"]) ||
      !validId(model.slug) ||
      typeof model.displayName !== "string" ||
      model.displayName.length > 256
    ) {
      throw new NativeChatGptError("protocol_error");
    }
    return { slug: model.slug, displayName: model.displayName };
  });
}

function parseSignIn(value: unknown): { profileId: string; email: string | null; planEnabled: boolean } {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["profileId", "email", "planEnabled", "active"]) ||
    !validId(value.profileId) ||
    !(value.email === null || (typeof value.email === "string" && value.email.length <= 320)) ||
    typeof value.planEnabled !== "boolean" ||
    value.active !== true
  ) {
    throw new NativeChatGptError("protocol_error");
  }
  return { profileId: value.profileId, email: value.email, planEnabled: value.planEnabled };
}

function parseSelection(value: unknown, expectedProfileId: string): void {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["profileId", "selected"]) ||
    value.profileId !== expectedProfileId ||
    value.selected !== true
  ) {
    throw new NativeChatGptError("protocol_error");
  }
}

export async function refreshNativeChatGptSnapshot(): Promise<{
  status: NativeChatGptStatus;
  profiles: NativeChatGptProfile[];
}> {
  const status = parseStatus(await nativeChatGptBridge.call("status", {}));
  const profiles = parseProfiles(await nativeChatGptBridge.call("listProfiles", {}));
  return { status, profiles };
}

export async function nativeChatGptSignIn(profileId?: string): Promise<{
  profileId: string;
  email: string | null;
  planEnabled: boolean;
}> {
  const params: Record<string, unknown> = {};
  if (profileId) params.profileId = profileId;
  return parseSignIn(await nativeChatGptBridge.call("signIn", params));
}

export async function nativeChatGptSelectProfile(profileId: string): Promise<void> {
  if (!validId(profileId)) throw new NativeChatGptError("profile_invalid");
  parseSelection(
    await nativeChatGptBridge.call("selectProfile", { profileId }),
    profileId,
  );
}

export async function nativeChatGptListModels(profileId: string): Promise<NativeChatGptModel[]> {
  if (!validId(profileId)) throw new NativeChatGptError("profile_invalid");
  return parseModels(
    await nativeChatGptBridge.call("listModels", { profileId }),
    profileId,
  );
}

export async function nativeChatGptSignOut(profileId: string): Promise<void> {
  if (!validId(profileId)) throw new NativeChatGptError("profile_invalid");
  const result = await nativeChatGptBridge.call<unknown>("signOut", { profileId });
  if (
    !isRecord(result) ||
    !hasOnlyKeys(result, ["profileId", "localCredentialsCleared", "remoteRevocation", "detail"]) ||
    result.profileId !== profileId ||
    result.localCredentialsCleared !== true ||
    result.remoteRevocation !== "not_attempted" ||
    typeof result.detail !== "string" ||
    result.detail.length > 512
  ) {
    throw new NativeChatGptError("protocol_error");
  }
}

export function parseNativeDraftResult(value: unknown, expectedProfileId: string): string {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["profileId", "text", "completed"]) ||
    value.profileId !== expectedProfileId ||
    typeof value.text !== "string" ||
    utf8Bytes(value.text) > 512 * 1024 ||
    value.completed !== true
  ) {
    throw new NativeChatGptError("protocol_error");
  }
  return value.text;
}
