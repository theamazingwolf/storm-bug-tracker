export const NATIVE_CHATGPT_HOST = "com.storm.bug_tracker.chatgpt";
// Full native frame budget, including its four-byte length prefix.
export const NATIVE_REQUEST_MAX_BYTES = 256 * 1024;
export const NATIVE_INSTRUCTIONS_MAX_BYTES = 16_000;

export type NativeRequestId = string | number;
export type NativeErrorCode = string;

export class NativeChatGptError extends Error {
  constructor(
    readonly code: string,
    message = "The local ChatGPT helper could not complete the request.",
  ) {
    super(message);
    this.name = "NativeChatGptError";
  }
}

export class NativeHostUnavailableError extends NativeChatGptError {
  constructor() {
    super("host_unavailable", "Install the local ChatGPT helper, then check the connection again.");
    this.name = "NativeHostUnavailableError";
  }
}

export class NativeHostDisconnectedError extends NativeChatGptError {
  constructor() {
    super("host_disconnected");
    this.name = "NativeHostDisconnectedError";
  }
}

export class NativeProtocolError extends NativeChatGptError {
  constructor() {
    super("protocol_error");
    this.name = "NativeProtocolError";
  }
}

export class NativeRequestTimeoutError extends NativeChatGptError {
  constructor() {
    super("timeout", "The local ChatGPT helper timed out. No automatic retry was made.");
    this.name = "NativeRequestTimeoutError";
  }
}

export class NativeRequestCancelledError extends NativeChatGptError {
  constructor() {
    super("cancelled", "The local ChatGPT request was cancelled.");
    this.name = "NativeRequestCancelledError";
  }
}

export class NativeRequestTooLargeError extends NativeChatGptError {
  constructor() {
    super("request_too_large", "The captured context is too large. Shorten it and try again.");
    this.name = "NativeRequestTooLargeError";
  }
}

export interface NativeResponseError {
  code: NativeErrorCode;
}

export interface NativeResponse {
  id: NativeRequestId;
  result?: unknown;
  error?: NativeResponseError;
}

export interface NativeEvent {
  event: string;
  data?: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNativeRequestId(value: unknown): value is NativeRequestId {
  return (
    (typeof value === "string" && value.length > 0 && value.length <= 128) ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function parseNativeFrame(value: unknown): NativeResponse | NativeEvent {
  if (!isRecord(value)) throw new NativeProtocolError();
  if (typeof value.event === "string") {
    if (!hasOnlyKeys(value, ["event", "data"]) || value.event.length > 64) {
      throw new NativeProtocolError();
    }
    if (value.event === "draftDelta") {
      if (
        !isRecord(value.data) ||
        !hasOnlyKeys(value.data, ["requestId", "delta"]) ||
        !isNativeRequestId(value.data.requestId) ||
        typeof value.data.delta !== "string" ||
        new TextEncoder().encode(value.data.delta).byteLength > 64 * 1024
      ) {
        throw new NativeProtocolError();
      }
    }
    return { event: value.event, data: value.data };
  }

  if (
    !hasOnlyKeys(value, ["id", "result", "error"]) ||
    !isNativeRequestId(value.id) ||
    ("result" in value) === ("error" in value)
  ) {
    throw new NativeProtocolError();
  }
  if ("error" in value) {
    if (
      !isRecord(value.error) ||
      !hasOnlyKeys(value.error, ["code", "message"]) ||
      typeof value.error.code !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.error.code) ||
      ("message" in value.error &&
        (typeof value.error.message !== "string" || value.error.message.length > 256))
    ) {
      throw new NativeProtocolError();
    }
    return { id: value.id, error: { code: value.error.code } };
  }
  return { id: value.id, result: value.result };
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function validateNativeRequest(
  method: string,
  params: Record<string, unknown>,
): void {
  if (!isRecord(params)) throw new NativeProtocolError();
  const stringId = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 128;
  let valid = false;
  switch (method) {
    case "status":
    case "listProfiles":
      valid = Object.keys(params).length === 0;
      break;
    case "signIn":
      valid = hasOnlyKeys(params, ["profileId", "reconnect"]) &&
        (params.profileId === undefined || stringId(params.profileId)) &&
        (params.reconnect === undefined || typeof params.reconnect === "boolean");
      break;
    case "selectProfile":
    case "signOut":
      valid = hasOnlyKeys(params, ["profileId"]) && stringId(params.profileId);
      break;
    case "listModels":
      valid = hasOnlyKeys(params, ["profileId"]) && stringId(params.profileId);
      break;
    case "draft":
      valid = hasOnlyKeys(params, ["profileId", "model", "text", "imageChoice", "instructions"]) &&
        stringId(params.profileId) &&
        stringId(params.model) &&
        typeof params.text === "string" &&
        params.imageChoice === "text-only" &&
        typeof params.instructions === "string" &&
        utf8Bytes(params.instructions) <= NATIVE_INSTRUCTIONS_MAX_BYTES;
      break;
    case "cancel":
      valid = hasOnlyKeys(params, ["requestId"]) && isNativeRequestId(params.requestId);
      break;
  }
  if (!valid) throw new NativeProtocolError();
}
