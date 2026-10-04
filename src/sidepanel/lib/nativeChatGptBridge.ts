import {
  NativeChatGptError,
  NativeHostDisconnectedError,
  NativeHostUnavailableError,
  NativeProtocolError,
  NativeRequestCancelledError,
  NativeRequestTimeoutError,
  NativeRequestTooLargeError,
  NATIVE_CHATGPT_HOST,
  NATIVE_REQUEST_MAX_BYTES,
  isRecord,
  parseNativeFrame,
  utf8Bytes,
  validateNativeRequest,
  type NativeRequestId,
} from "./nativeChatGptProtocol";
import { useNativeChatGptUiStore } from "@/store/native-chatgpt-ui-store";

export interface NativePortLike {
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  postMessage(message: unknown): void;
  disconnect(): void;
}

export type NativePortConnector = (hostName: string) => NativePortLike;

export const NATIVE_METHOD_TIMEOUT_MS = {
  status: 5_000,
  listProfiles: 5_000,
  selectProfile: 10_000,
  signIn: 120_000,
  listModels: 30_000,
  draft: 180_000,
  cancel: 5_000,
  signOut: 10_000,
} as const;

type PendingCall = {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortListener?: () => void;
};

const idKey = (id: NativeRequestId) => `${typeof id}:${String(id)}`;

export class NativeChatGptBridge {
  private port: NativePortLike | null = null;
  private nextId = 0;
  private pending = new Map<string, PendingCall>();
  private retired = new Set<string>();
  private retiredOrder: string[] = [];

  constructor(
    private readonly connectPort: NativePortConnector = (hostName) =>
      chrome.runtime.connectNative(hostName),
  ) {}

  get connected(): boolean {
    return this.port !== null;
  }

  async call<T = unknown>(
    method: keyof typeof NATIVE_METHOD_TIMEOUT_MS,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    if (options.signal?.aborted) throw new NativeRequestCancelledError();
    validateNativeRequest(method, params);
    const id = this.allocateId();
    const message = { id, method, params };
    let encoded: string;
    try {
      encoded = JSON.stringify(message);
    } catch {
      throw new NativeProtocolError();
    }
    if (utf8Bytes(encoded) > NATIVE_REQUEST_MAX_BYTES) {
      throw new NativeRequestTooLargeError();
    }
    const port = this.getPort();

    const key = idKey(id);
    const timeoutMs = options.timeoutMs ?? NATIVE_METHOD_TIMEOUT_MS[method];
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.detachAbort(key);
        this.pending.delete(key);
        this.retire(key);
        reject(new NativeRequestTimeoutError());
        if (method === "draft") void this.sendCancel(id);
      }, timeoutMs);
      const pending: PendingCall = {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        signal: options.signal,
      };
      if (options.signal) {
        pending.abortListener = () => {
          if (!this.pending.has(key)) return;
          this.detachAbort(key);
          this.pending.delete(key);
          clearTimeout(timer);
          this.retire(key);
          reject(new NativeRequestCancelledError());
          if (method === "draft") void this.sendCancel(id);
        };
        options.signal.addEventListener("abort", pending.abortListener, { once: true });
      }
      this.pending.set(key, pending);
      try {
        port.postMessage(message);
      } catch {
        this.detachAbort(key);
        this.pending.delete(key);
        clearTimeout(timer);
        this.retire(key);
        reject(new NativeHostDisconnectedError());
        this.failAll(new NativeHostDisconnectedError());
      }
    });
  }

  private allocateId(): string {
    this.nextId = this.nextId >= Number.MAX_SAFE_INTEGER ? 1 : this.nextId + 1;
    return `storm-chatgpt-${this.nextId}`;
  }

  private getPort(): NativePortLike {
    if (this.port) return this.port;
    let port: NativePortLike;
    try {
      port = this.connectPort(NATIVE_CHATGPT_HOST);
    } catch {
      throw new NativeHostUnavailableError();
    }
    this.port = port;
    useNativeChatGptUiStore.getState().setTransportConnected(true);
    port.onMessage.addListener((message) => this.handleMessage(message));
    port.onDisconnect.addListener(() => this.handleDisconnect(port));
    return port;
  }

  private handleMessage(message: unknown): void {
    let frame: ReturnType<typeof parseNativeFrame>;
    try {
      frame = parseNativeFrame(message);
    } catch {
      this.failAll(new NativeProtocolError());
      return;
    }
    if ("event" in frame) {
      // Deltas are progress-only. They never resolve a request or become draft output.
      if (frame.event === "draftDelta" && isRecord(frame.data)) {
        const key = idKey(frame.data.requestId as NativeRequestId);
        const request = this.pending.get(key);
        if (!request || request.method !== "draft") return;
      }
      return;
    }

    const key = idKey(frame.id);
    const pending = this.pending.get(key);
    if (!pending) {
      if (this.retired.has(key)) return; // expected late response after timeout/cancel.
      this.failAll(new NativeProtocolError());
      return;
    }
    this.detachAbort(key);
    this.pending.delete(key);
    clearTimeout(pending.timer);
    this.retire(key);
    if (frame.error) {
      // Ignore the helper's prose. Only the normalized code crosses this boundary.
      pending.reject(new NativeChatGptError(frame.error.code));
      return;
    }
    pending.resolve(frame.result);
  }

  private async sendCancel(requestId: NativeRequestId): Promise<void> {
    try {
      const result = await this.call<unknown>(
        "cancel",
        { requestId },
        { timeoutMs: NATIVE_METHOD_TIMEOUT_MS.cancel },
      );
      if (
        !isRecord(result) ||
        Object.keys(result).some((key) => !["requestId", "cancelled"].includes(key)) ||
        result.requestId !== requestId ||
        typeof result.cancelled !== "boolean"
      ) {
        throw new NativeProtocolError();
      }
    } catch {
      // The original call remains cancelled locally; a failed best-effort cancel is not retried.
    }
  }

  private detachAbort(key: string): void {
    const pending = this.pending.get(key);
    if (pending?.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
  }

  private retire(key: string): void {
    if (this.retired.has(key)) return;
    this.retired.add(key);
    this.retiredOrder.push(key);
    if (this.retiredOrder.length > 512) {
      const old = this.retiredOrder.shift();
      if (old) this.retired.delete(old);
    }
  }

  private failAll(error: Error): void {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.detachAbort(key);
      pending.reject(error);
      this.retire(key);
    }
    this.pending.clear();
    if (this.port) {
      const port = this.port;
      this.disconnectPort(port);
      try {
        port.disconnect();
      } catch {
        // The transport is already closed; local pending calls have still been rejected.
      }
    }
  }

  private handleDisconnect(port: NativePortLike): void {
    let message = "";
    try {
      if (typeof chrome !== "undefined") message = chrome.runtime.lastError?.message ?? "";
    } catch {
      // Browser error state is diagnostic only; unknown access failures stay generic.
    }
    const error = /specified native messaging host (?:not found|is forbidden)|native messaging host.*not found/i.test(message)
      ? new NativeHostUnavailableError()
      : new NativeHostDisconnectedError();
    this.disconnectPort(port, error);
  }

  private disconnectPort(
    port: NativePortLike,
    error: Error = new NativeHostDisconnectedError(),
  ): void {
    if (this.port !== port) return;
    this.port = null;
    useNativeChatGptUiStore.getState().setTransportConnected(false);
    this.failPendingOnDisconnect(error);
  }

  private failPendingOnDisconnect(error: Error): void {
    for (const [key, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.detachAbort(key);
      pending.reject(error);
      this.retire(key);
    }
    this.pending.clear();
  }

}

export const nativeChatGptBridge = new NativeChatGptBridge();
