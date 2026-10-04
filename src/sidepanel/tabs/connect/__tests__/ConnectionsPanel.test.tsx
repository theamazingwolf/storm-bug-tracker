import { render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/lib/bg-client", () => ({ sendBg: (req: unknown) => sendBg(req) }));

import { useSettingsStore } from "@/store/settings-store";
import type { GithubAccount } from "@/types/github";
import type { LinearAccount } from "@/types/linear";
import { ConnectionsPanel } from "../ConnectionsPanel";

const gh = (login: string, email?: string): GithubAccount => ({
  platform: "github",
  connectedAt: 1,
  auth: { kind: "pat", pat: `pat-${login}`, viewerLogin: login, viewerEmail: email },
  defaults: {},
});
const lin = (name: string, key: string): LinearAccount => ({
  platform: "linear",
  connectedAt: 1,
  auth: { kind: "apiKey", apiKey: key, viewerName: name, viewerEmail: "same@example.test" },
  defaults: {},
});

const state = () => useSettingsStore.getState();

function renderGithub() {
  return render(
    <ConnectionsPanel
      platform="github"
      renderReconnect={(record, renderTrigger) => (
        <span data-testid={`reconnect-${record.id}`}>
          {renderTrigger({ onClick: () => {}, connecting: false, disabled: false })}
        </span>
      )}
    />,
  );
}

function renderLinear() {
  return render(
    <ConnectionsPanel
      platform="linear"
      renderReconnect={(_record, renderTrigger) => renderTrigger({ onClick: () => {}, connecting: false, disabled: false })}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sendBg.mockReset();
  sendBg.mockResolvedValue(undefined);
  useSettingsStore.setState({
    accounts: {}, lastSubmitFields: {}, connections: { github: [], linear: [] },
    selectedConnectionIds: {}, destinationProfiles: [], websiteOriginMappings: [],
  });
});

describe("ConnectionsPanel — GitHub", () => {
  it("lists every account with its identity and marks only the selected one", () => {
    state().addConnection("github", gh("alpha", "a@example.test"));
    state().addConnection("github", gh("beta"));
    renderGithub();
    const items = within(screen.getByRole("list", { name: "connections.list.aria:platform.tab.github" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("alpha")).toBeTruthy();
    expect(within(items[0]).getByText("a@example.test")).toBeTruthy();
    expect(within(items[1]).getByText("beta")).toBeTruthy();
    expect(within(items[0]).getByRole("button", { name: "connections.select.aria:alpha" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(items[1]).getByRole("button", { name: "connections.select.aria:beta" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("selecting is explicit and swaps the selected projection", async () => {
    const a = state().addConnection("github", gh("alpha"));
    const b = state().addConnection("github", gh("beta"));
    const user = userEvent.setup();
    renderGithub();
    await user.click(screen.getByRole("button", { name: "connections.select.aria:beta" }));
    expect(state().selectedConnectionIds.github).toBe(b);
    expect(state().accounts.github?.auth).toMatchObject({ viewerLogin: "beta" });
    expect(state().getConnection("github", a)).toBeTruthy();
  });

  it("removing states the effect, removes dependents, and does not auto-select another account", async () => {
    const a = state().addConnection("github", gh("alpha"));
    const b = state().addConnection("github", gh("beta"));
    state().saveDestinationProfile({ id: "d-a", platform: "github", connectionId: a, owner: "o", repo: "r" });
    state().saveDestinationProfile({ id: "d-b", platform: "github", connectionId: b, owner: "o", repo: "s" });
    state().setWebsiteOriginMapping("https://a.test", "d-a");
    state().setWebsiteOriginMapping("https://a2.test", "d-a");
    state().setWebsiteOriginMapping("https://b.test", "d-b");
    const user = userEvent.setup();
    renderGithub();

    await user.click(screen.getByRole("button", { name: "connections.remove.aria:alpha" }));
    expect(await screen.findByText("connections.remove.body:1,2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "connections.remove.confirm" }));

    expect(state().connections.github.map((c) => c.id)).toEqual([b]);
    expect(state().selectedConnectionIds.github).toBeUndefined();
    expect(state().accounts.github).toBeUndefined();
    expect(state().destinationProfiles.map((p) => p.id)).toEqual(["d-b"]);
    expect(state().websiteOriginMappings).toEqual([{ origin: "https://b.test", destinationId: "d-b" }]);
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "connections.noneSelected:platform.tab.github");
    expect(screen.getByRole("button", { name: "connections.select.aria:beta" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("cancelling the removal keeps everything", async () => {
    state().addConnection("github", gh("alpha"));
    const user = userEvent.setup();
    renderGithub();
    await user.click(screen.getByRole("button", { name: "connections.remove.aria:alpha" }));
    await user.click(await screen.findByRole("button", { name: "common.cancel" }));
    expect(state().connections.github).toHaveLength(1);
  });

  it("renders a reconnect control bound to each record", () => {
    const a = state().addConnection("github", gh("alpha"));
    const b = state().addConnection("github", gh("beta"));
    renderGithub();
    expect(within(screen.getByTestId(`reconnect-${a}`)).getByRole("button", { name: "connections.reconnect.aria:alpha" })).toBeTruthy();
    expect(within(screen.getByTestId(`reconnect-${b}`)).getByRole("button", { name: "connections.reconnect.aria:beta" })).toBeTruthy();
  });
});

describe("ConnectionsPanel — Linear", () => {
  it("shows the same viewer separately per verified workspace with name and id", () => {
    state().addConnection("linear", lin("Same Viewer", "k1"), { organization: { id: "org-1", name: "Acme" } });
    state().addConnection("linear", lin("Same Viewer", "k2"), { organization: { id: "org-2", name: "Globex" } });
    renderLinear();
    expect(screen.getByText("connections.workspace:Acme,org-1")).toBeTruthy();
    expect(screen.getByText("connections.workspace:Globex,org-2")).toBeTruthy();
    expect(screen.getAllByText("Same Viewer")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "connections.select.aria:Same Viewer · Acme" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "connections.select.aria:Same Viewer · Globex" })).toBeTruthy();
  });

  it("verifies a legacy workspace using that record's own id and persists it", async () => {
    const id = state().addConnection("linear", lin("Legacy", "k"));
    sendBg.mockResolvedValue({ id: "org-9", name: "Nine" });
    const user = userEvent.setup();
    renderLinear();
    expect(screen.getByText("connections.workspace.unverified")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "connections.workspace.verify" }));
    await waitFor(() => expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-9", name: "Nine" }));
    expect(sendBg).toHaveBeenCalledWith({ type: "linear.getOrganization", connectionId: id });
  });

  it("keeps the record unverified and shows a localized error when the lookup fails", async () => {
    const id = state().addConnection("linear", lin("Legacy", "k"));
    sendBg.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderLinear();
    await user.click(screen.getByRole("button", { name: "connections.workspace.verify" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("boom"));
    expect(state().getConnection("linear", id)?.organization).toBeUndefined();
  });

  it("refuses to relabel a record whose stored workspace differs from the lookup", async () => {
    const id = state().addConnection("linear", lin("V", "k"), { organization: { id: "org-1", name: "One" } });
    renderLinear();
    // direct store call mirrors what a mismatching lookup would attempt
    expect(() => state().setLinearConnectionOrganization(id, { id: "org-2", name: "Two" })).toThrow();
    expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-1", name: "One" });
  });
});

describe("ConnectionsPanel — defaults editing is per record", () => {
  it("opens the defaults of one record only and scopes its requests to that record id", async () => {
    const a = state().addConnection("github", gh("alpha"));
    state().addConnection("github", gh("beta"));
    sendBg.mockResolvedValue([]);
    const user = userEvent.setup();
    renderGithub();
    const row = screen.getByTestId(`connection-${a}`);
    await user.click(within(row).getByRole("button", { name: "connections.defaults" }));
    expect(screen.getAllByTestId(/^connection-defaults-/)).toHaveLength(1);
    await user.click(within(row).getByRole("combobox", { name: "connections.defaults.field:github.section.repo,alpha" }));
    await waitFor(() => expect(sendBg).toHaveBeenCalledWith({ type: "github.searchRepos", query: "", connectionId: a }));
  });
});
