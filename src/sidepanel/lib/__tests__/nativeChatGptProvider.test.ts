import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeChatGptProvider } from "../nativeChatGptProvider";
import { NATIVE_INSTRUCTIONS_MAX_BYTES, NativeChatGptError } from "../nativeChatGptProtocol";
import { parseNativeDraftResult } from "../nativeChatGptClient";
import type { NativePortLike } from "../nativeChatGptBridge";

class Event<T> {
  listeners: ((value: T) => void)[] = [];
  addListener = (listener: (value: T) => void) => this.listeners.push(listener);
  emit(value: T) { for (const listener of this.listeners) listener(value); }
}
class FakePort implements NativePortLike {
  onMessage = new Event<unknown>();
  onDisconnect = new Event<void>();
  posted: unknown[] = [];
  postMessage(message: unknown) { this.posted.push(message); }
  disconnect() { this.onDisconnect.emit(); }
  respond(message: unknown) { this.onMessage.emit(message); }
}
let port: FakePort;

afterEach(() => {
  port?.disconnect();
  vi.unstubAllGlobals();
});

function installPort() {
  port = new FakePort();
  vi.stubGlobal("chrome", {
    runtime: { connectNative: vi.fn(() => port) },
  });
}

describe("Native ChatGPT AIProvider", () => {
  it("keeps app instructions/schema separate from captured context and pins profile/model", async () => {
    installPort();
    const provider = createNativeChatGptProvider({ profileId: "profile-exact", modelId: "model-exact" });
    const session = await provider.createSession(
      "Write an issue report and return JSON.",
      [{ user: "example", assistant: "{}" }],
      { untrustedContext: JSON.stringify({ pageTitle: "CAPTURED_SECRET_TITLE" }) },
    );
    const promise = session.prompt("USER_INPUT_ONLY", {
      responseSchema: { type: "object", properties: { title: { type: "string" } } },
    });
    await vi.waitFor(() => expect(port.posted).toHaveLength(1));
    const request = port.posted[0] as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    expect(request.method).toBe("draft");
    expect(request.params.profileId).toBe("profile-exact");
    expect(request.params.model).toBe("model-exact");
    expect(request.params.imageChoice).toBe("text-only");
    expect(request.params.instructions).toContain("Write an issue report");
    expect(request.params.instructions).toContain("Required response schema");
    expect(request.params.instructions).toContain("Application formatting examples");
    expect(request.params.instructions).not.toContain("CAPTURED_SECRET_TITLE");
    expect(request.params.text).toContain("CAPTURED_SECRET_TITLE");
    expect(request.params.text).toContain("USER_INPUT_ONLY");
    port.respond({ event: "draftDelta", data: { requestId: request.id, delta: "partial only" } });
    expect(port.posted).toHaveLength(1);
    port.respond({ id: request.id, result: { profileId: "profile-exact", text: "{\"title\":\"Complete\"}", completed: true } });
    await expect(promise).resolves.toBe('{"title":"Complete"}');
  });

  it("refuses missing separated context and rejects images without calling the helper", async () => {
    installPort();
    const provider = createNativeChatGptProvider({ profileId: "p1", modelId: "m1" });
    await expect(provider.createSession("instructions")).rejects.toBeInstanceOf(NativeChatGptError);
    const session = await provider.createSession("instructions", undefined, { untrustedContext: "{}" });
    await expect(session.prompt("input", { images: ["data:image/png;base64,AA=="] })).rejects.toMatchObject({ name: "LlmUnsupportedRequestError" });
    expect(port.posted).toHaveLength(0);
  });

  it("bounds UTF-8 instructions to the helper's optional field contract", async () => {
    installPort();
    const provider = createNativeChatGptProvider({ profileId: "p1", modelId: "m1" });
    const session = await provider.createSession(
      "é".repeat(NATIVE_INSTRUCTIONS_MAX_BYTES),
      undefined,
      { untrustedContext: "{}" },
    );
    expect(() => session.prompt("input")).toThrow(NativeChatGptError);
    expect(port.posted).toHaveLength(0);
  });

  it("accepts only completed results for the pinned profile", () => {
    expect(parseNativeDraftResult({ profileId: "p1", text: "full", completed: true }, "p1")).toBe("full");
    expect(() => parseNativeDraftResult({ profileId: "p1", text: "partial", completed: false }, "p1"))
      .toThrow(NativeChatGptError);
    expect(() => parseNativeDraftResult({ profileId: "other", text: "full", completed: true }, "p1"))
      .toThrow(NativeChatGptError);
  });

  it("generate sends instructions and user prompt in separate native fields", async () => {
    installPort();
    const provider = createNativeChatGptProvider({ profileId: "p2", modelId: "m2" });
    const promise = provider.generate({ systemPrompt: "TRUSTED", prompt: "UNTRUSTED" });
    const request = port.posted[0] as { id: string; params: Record<string, unknown> };
    expect(request.params.instructions).toContain("TRUSTED");
    expect(request.params.text).toContain("UNTRUSTED");
    port.respond({ id: request.id, result: { profileId: "p2", text: "done", completed: true } });
    await expect(promise).resolves.toBe("done");
  });
});
