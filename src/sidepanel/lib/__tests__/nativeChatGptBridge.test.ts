import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NativeChatGptBridge,
  type NativePortLike,
} from "../nativeChatGptBridge";
import {
  NativeHostDisconnectedError,
  NativeHostUnavailableError,
  NativeProtocolError,
  NativeRequestCancelledError,
  NativeRequestTimeoutError,
  NativeRequestTooLargeError,
  NATIVE_REQUEST_MAX_BYTES,
} from "../nativeChatGptProtocol";

class Event<T> {
  listeners: ((value: T) => void)[] = [];
  addListener = (listener: (value: T) => void) => this.listeners.push(listener);
  emit(value: T) { for (const listener of this.listeners) listener(value); }
}

class FakePort implements NativePortLike {
  onMessage = new Event<unknown>();
  onDisconnect = new Event<void>();
  posted: unknown[] = [];
  postMessage = vi.fn((message: unknown) => this.posted.push(message));
  disconnect = vi.fn(() => this.onDisconnect.emit());
  respond(message: unknown) { this.onMessage.emit(message); }
}

const draftParams = (overrides: Record<string, unknown> = {}) => ({
  profileId: "p1",
  model: "m1",
  text: "text",
  imageChoice: "text-only",
  instructions: "instructions",
  ...overrides,
});

function setup() {
  const port = new FakePort();
  const bridge = new NativeChatGptBridge(() => port);
  return { bridge, port };
}

afterEach(() => vi.unstubAllGlobals());

describe("NativeChatGptBridge", () => {
  it("shares one port and correlates concurrent responses by unique request IDs", async () => {
    const { bridge, port } = setup();
    const first = bridge.call("status", {});
    const second = bridge.call("listProfiles", {});
    expect(port.posted).toHaveLength(2);
    const [a, b] = port.posted as { id: string; method: string }[];
    expect(a.id).not.toBe(b.id);
    port.respond({ id: b.id, result: { profiles: [] } });
    port.respond({ id: a.id, result: { connected: true } });
    await expect(first).resolves.toEqual({ connected: true });
    await expect(second).resolves.toEqual({ profiles: [] });
  });

  it("ignores valid draft deltas and accepts only a correlated final result", async () => {
    const { bridge, port } = setup();
    const result = bridge.call("draft", draftParams());
    const request = port.posted[0] as { id: string };
    port.respond({ event: "draftDelta", data: { requestId: request.id, delta: "partial" } });
    expect(port.posted).toHaveLength(1);
    port.respond({ id: request.id, result: { completed: true } });
    await expect(result).resolves.toEqual({ completed: true });
  });

  it("rejects malformed frames and uncorrelated response IDs without resolving another call", async () => {
    const { bridge, port } = setup();
    const result = bridge.call("status", {});
    port.respond({ id: "unrelated", result: {} });
    await expect(result).rejects.toBeInstanceOf(NativeProtocolError);
    expect(bridge.connected).toBe(false);

    const next = bridge.call("status", {});
    port.respond({ id: (port.posted[1] as { id: string }).id, result: {}, extra: true });
    await expect(next).rejects.toBeInstanceOf(NativeProtocolError);
  });

  it("ignores late responses after cancellation, sends a best-effort cancel, and never retries", async () => {
    const { bridge, port } = setup();
    const controller = new AbortController();
    const result = bridge.call("draft", draftParams(), { signal: controller.signal });
    const draft = port.posted[0] as { id: string };
    controller.abort();
    await expect(result).rejects.toBeInstanceOf(NativeRequestCancelledError);
    const cancel = port.posted[1] as { id: string; method: string; params: { requestId: string } };
    expect(cancel.method).toBe("cancel");
    expect(cancel.params.requestId).toBe(draft.id);
    port.respond({ id: draft.id, result: { text: "late" } });
    port.respond({ id: cancel.id, result: { requestId: draft.id, cancelled: true } });
    expect(port.posted).toHaveLength(2);
  });

  it("maps an uninstalled native host to setup guidance without exposing browser diagnostics", async () => {
    const { bridge, port } = setup();
    vi.stubGlobal("chrome", {
      runtime: { lastError: { message: "Specified native messaging host not found." } },
    });
    const result = bridge.call("status", {});
    const rejected = expect(result).rejects.toBeInstanceOf(NativeHostUnavailableError);
    port.onDisconnect.emit();
    await rejected;
    await expect(result).rejects.toMatchObject({ message: expect.not.stringContaining("Specified") });
  });

  it("maps timeout and disconnect to typed errors", async () => {
    vi.useFakeTimers();
    try {
      const { bridge, port } = setup();
      const timed = bridge.call("draft", draftParams(), { timeoutMs: 20 });
      const timeout = expect(timed).rejects.toBeInstanceOf(NativeRequestTimeoutError);
      await vi.advanceTimersByTimeAsync(20);
      await timeout;
      // The timeout schedules a cancel command. It is best effort and has its own bounded timer.
      const status = bridge.call("status", {});
      const disconnected = expect(status).rejects.toBeInstanceOf(NativeHostDisconnectedError);
      port.onDisconnect.emit();
      await disconnected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels timed-out sign-in once and ignores its late result without retrying", async () => {
    vi.useFakeTimers();
    try {
      const { bridge, port } = setup();
      const pending = bridge.call("signIn", {}, { timeoutMs: 20 });
      const failed = expect(pending).rejects.toBeInstanceOf(NativeRequestTimeoutError);
      const signInId = (port.posted[0] as { id: string }).id;
      await vi.advanceTimersByTimeAsync(20);
      await failed;
      const cancel = port.posted[1] as { id: string; method: string; params: { requestId: string } };
      expect(cancel).toMatchObject({ method: "cancel", params: { requestId: signInId } });
      port.respond({ id: cancel.id, result: { requestId: signInId, cancelled: true } });
      port.respond({ id: signInId, result: { active: true } });
      expect(port.posted).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed method parameters before opening the host", async () => {
    const { bridge, port } = setup();
    await expect(bridge.call("draft", draftParams({ instructions: "😀".repeat(4_001) })))
      .rejects.toBeInstanceOf(NativeProtocolError);
    await expect(bridge.call("status", { unexpected: true }))
      .rejects.toBeInstanceOf(NativeProtocolError);
    expect(bridge.connected).toBe(false);
    expect(port.posted).toHaveLength(0);
  });

  it("does not post oversized Native Messaging requests", async () => {
    const { bridge, port } = setup();
    await expect(
      bridge.call("draft", draftParams({ text: "x".repeat(NATIVE_REQUEST_MAX_BYTES) })),
    ).rejects.toBeInstanceOf(NativeRequestTooLargeError);
    expect(port.posted).toHaveLength(0);
  });

  it("counts the four-byte native header at the exact request-size boundary", async () => {
    const params = draftParams({ text: "" });
    const empty = JSON.stringify({ id: "storm-chatgpt-1", method: "draft", params });
    const remaining = NATIVE_REQUEST_MAX_BYTES - 4 - new TextEncoder().encode(empty).byteLength;
    // JSON escapes null characters to six bytes; text still fits the helper's character cap.
    params.text = "\0".repeat(Math.floor(remaining / 6)) + "x".repeat(remaining % 6);
    const { bridge, port } = setup();
    const pending = bridge.call("draft", params);
    expect(new TextEncoder().encode(JSON.stringify(port.posted[0])).byteLength + 4).toBe(NATIVE_REQUEST_MAX_BYTES);
    port.respond({ id: "storm-chatgpt-1", result: { completed: true } });
    await pending;

    const larger = setup();
    await expect(larger.bridge.call("draft", { ...params, text: String(params.text) + "x" }))
      .rejects.toBeInstanceOf(NativeRequestTooLargeError);
    expect(larger.port.posted).toHaveLength(0);
  });

  it("ignores duplicate completed responses instead of resolving another request", async () => {
    const { bridge, port } = setup();
    const first = bridge.call("status", {});
    const id = (port.posted[0] as { id: string }).id;
    port.respond({ id, result: "first" });
    await expect(first).resolves.toBe("first");
    port.respond({ id, result: "duplicate" });
    const second = bridge.call("status", {});
    const secondId = (port.posted[1] as { id: string }).id;
    port.respond({ id, result: "duplicate" });
    port.respond({ id: secondId, result: "second" });
    await expect(second).resolves.toBe("second");
  });
});
