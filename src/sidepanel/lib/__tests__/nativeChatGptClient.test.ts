import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativePortLike } from "../nativeChatGptBridge";
import {
  nativeChatGptListModels,
  nativeChatGptSignIn,
  nativeChatGptSignOut,
  refreshNativeChatGptSnapshot,
} from "../nativeChatGptClient";
import { NativeChatGptError } from "../nativeChatGptProtocol";

class Event<T> {
  listeners: ((value: T) => void)[] = [];
  addListener = (listener: (value: T) => void) => this.listeners.push(listener);
  emit(value: T) { for (const listener of this.listeners) listener(value); }
}
class FakePort implements NativePortLike {
  onMessage = new Event<unknown>();
  onDisconnect = new Event<void>();
  posted: { id: string; method: string; params: Record<string, unknown> }[] = [];
  postMessage(message: unknown) { this.posted.push(message as (typeof this.posted)[number]); }
  disconnect() { this.onDisconnect.emit(); }
  respond(index: number, result: unknown) { this.onMessage.emit({ id: this.posted[index].id, result }); }
}
let port: FakePort;

function setup() {
  port = new FakePort();
  vi.stubGlobal("chrome", { runtime: { connectNative: () => port } });
  return port;
}

afterEach(() => {
  port?.disconnect();
  vi.unstubAllGlobals();
});

describe("native ChatGPT helper client", () => {
  it("validates account data but retains only safe metadata", async () => {
    const fake = setup();
    const pending = refreshNativeChatGptSnapshot();
    fake.respond(0, {
      connected: true,
      activeProfileId: "profile-1",
      profile: { email: "user@example.test" },
      planEnabled: true,
      imageInput: "unsupported",
    });
    await vi.waitFor(() => expect(fake.posted).toHaveLength(2));
    fake.respond(1, {
      profiles: [{
        id: "profile-1",
        email: "user@example.test",
        subject: "must-not-retain",
        clientId: "must-not-retain-either",
        signedIn: true,
        planEnabled: true,
      }],
    });
    const snapshot = await pending;
    expect(snapshot.profiles).toEqual([{
      id: "profile-1", email: "user@example.test", signedIn: true, planEnabled: true,
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("must-not-retain");
  });

  it("accepts nullable email without discarding other profiles or sign-in success", async () => {
    const fake = setup();
    const pending = refreshNativeChatGptSnapshot();
    fake.respond(0, { connected: false, activeProfileId: null, profile: null, planEnabled: false, imageInput: "unsupported" });
    await vi.waitFor(() => expect(fake.posted).toHaveLength(2));
    fake.respond(1, { profiles: [
      { id: "no-email", email: null, subject: "subject-a", clientId: "client-a", signedIn: true, planEnabled: true },
      { id: "with-email", email: "user@example.test", subject: "subject-b", clientId: "client-b", signedIn: true, planEnabled: true },
    ] });
    await expect(pending).resolves.toMatchObject({ profiles: [
      { id: "no-email", email: null },
      { id: "with-email", email: "user@example.test" },
    ] });
    const signIn = nativeChatGptSignIn();
    fake.respond(2, { profileId: "no-email", email: null, planEnabled: true, active: true });
    await expect(signIn).resolves.toEqual({ profileId: "no-email", email: null, planEnabled: true });
  });

  it.each([undefined, 42, "x".repeat(321)])("still rejects invalid email metadata: %j", async (email) => {
    const fake = setup();
    const signIn = nativeChatGptSignIn();
    fake.respond(0, { profileId: "p", email, planEnabled: true, active: true });
    await expect(signIn).rejects.toBeInstanceOf(NativeChatGptError);
  });

  it("passes explicit profile IDs for model discovery and sign-in reconnect", async () => {
    const fake = setup();
    const models = nativeChatGptListModels("p-explicit");
    expect(fake.posted[0]).toEqual(expect.objectContaining({
      method: "listModels", params: { profileId: "p-explicit" },
    }));
    fake.respond(0, { profileId: "p-explicit", models: [{ slug: "model-a", displayName: "Model A" }] });
    await expect(models).resolves.toEqual([{ slug: "model-a", displayName: "Model A" }]);

    const signIn = nativeChatGptSignIn("p-explicit");
    expect(fake.posted[1].params).toEqual({ profileId: "p-explicit" });
    fake.respond(1, { profileId: "p-explicit", email: "a@example.test", planEnabled: true, active: true });
    await expect(signIn).resolves.toMatchObject({ profileId: "p-explicit", planEnabled: true });
  });

  it("rejects model-list profile mismatch and incomplete/partial results", async () => {
    const fake = setup();
    const mismatch = nativeChatGptListModels("requested-profile");
    fake.respond(0, { profileId: "other-profile", models: [] });
    await expect(mismatch).rejects.toBeInstanceOf(NativeChatGptError);

    const signOut = nativeChatGptSignOut("p1");
    fake.respond(1, {
      profileId: "p1",
      localCredentialsCleared: true,
      remoteRevocation: "revoked",
      detail: "must not claim remote revoke",
    });
    await expect(signOut).rejects.toBeInstanceOf(NativeChatGptError);
  });
});
