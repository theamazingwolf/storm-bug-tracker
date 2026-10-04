import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${Object.values(params).join(",")}` : key,
  t: (key: string) => key,
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));
const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({
  sendBg: (req: unknown) => sendBg(req),
  isOAuthCancelled: () => false,
}));

import { useSettingsStore } from "@/store/settings-store";
import { LinearConnectFlow } from "../LinearConnectForm";

const state = () => useSettingsStore.getState();
const onConnected = vi.fn();

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendBg.mockReset();
  useSettingsStore.setState({
    accounts: {}, lastSubmitFields: {}, connections: { github: [], linear: [] },
    selectedConnectionIds: {}, destinationProfiles: [], websiteOriginMappings: [],
  });
});

async function startVerify(inspect: Promise<unknown>) {
  sendBg.mockImplementation((req: { type: string }) => {
    if (req.type === "linear.oauth.available") return Promise.resolve({ available: false });
    if (req.type === "linear.testApiKey") return Promise.resolve({ id: "u-1", name: "Same" });
    if (req.type === "linear.inspectAuth") return inspect;
    return Promise.resolve(undefined);
  });
  const view = render(
    <LinearConnectFlow connected={false} onConnected={onConnected} autoStart={false} onAutoStartHandled={() => {}} />,
  );
  await waitFor(() => expect(screen.getByRole("button")).not.toHaveProperty("disabled", true));
  await userEvent.click(screen.getByRole("button"));
  await userEvent.type(await screen.findByPlaceholderText("linear.apiKeyPlaceholder"), "lin_api_secret");
  await userEvent.click(screen.getByRole("button", { name: "common.verify" }));
  await waitFor(() => expect(sendBg.mock.calls.some(([r]) => r.type === "linear.inspectAuth")).toBe(true));
  return view;
}

describe("Linear API-key flow — abandoned attempts", () => {
  it("commits and reports the id when the attempt stays open", async () => {
    const d = deferred<unknown>();
    await startVerify(d.promise);
    d.resolve({ viewer: { id: "u-1", name: "Same" }, organization: { id: "org-1", name: "One" } });
    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    const [id] = onConnected.mock.calls[0];
    expect(state().getConnection("linear", id)).toMatchObject({ organization: { id: "org-1", name: "One" }, account: { auth: { viewerId: "u-1" } } });
  });

  it("closing the dialog while the workspace check is pending stores nothing later", async () => {
    const d = deferred<unknown>();
    await startVerify(d.promise);
    await userEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    d.resolve({ viewer: { id: "u-1", name: "Same" }, organization: { id: "org-1", name: "One" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(state().connections.linear).toEqual([]);
    expect(state().selectedConnectionIds.linear).toBeUndefined();
    expect(onConnected).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("unmounting during the check stores nothing later", async () => {
    const d = deferred<unknown>();
    const { unmount } = await startVerify(d.promise);
    unmount();
    d.resolve({ viewer: { id: "u-1", name: "Same" }, organization: { id: "org-1", name: "One" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(state().connections.linear).toEqual([]);
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("a rejected workspace check shows an error and persists nothing", async () => {
    const d = deferred<unknown>();
    await startVerify(d.promise);
    d.resolve({ viewer: { id: "u-1", name: "Same" }, organization: { id: "", name: "" } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("connections.error.orgUnverified"));
    expect(state().connections.linear).toEqual([]);
  });
});
