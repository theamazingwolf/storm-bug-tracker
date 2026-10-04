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
import { DestinationsSection } from "../DestinationsSection";

const gh = (login: string): GithubAccount => ({
  platform: "github",
  connectedAt: 1,
  auth: { kind: "pat", pat: `pat-${login}`, viewerLogin: login },
  defaults: {},
});
const lin = (name: string): LinearAccount => ({
  platform: "linear",
  connectedAt: 1,
  auth: { kind: "apiKey", apiKey: `key-${name}`, viewerName: name, viewerEmail: "same@example.test" },
  defaults: {},
});

const state = () => useSettingsStore.getState();

function repo(owner: string, name: string) {
  return { id: 1, nodeId: "n", owner, name, fullName: `${owner}/${name}`, private: false, htmlUrl: "", hasIssues: true, archived: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    accounts: {}, lastSubmitFields: {}, connections: { github: [], linear: [] },
    selectedConnectionIds: {}, destinationProfiles: [], websiteOriginMappings: [],
  });
});

describe("DestinationsSection — origin rules", () => {
  function seed() {
    const id = state().addConnection("github", gh("octo"));
    state().saveDestinationProfile({ id: "mono", platform: "github", connectionId: id, owner: "acme", repo: "mono" });
    state().saveDestinationProfile({ id: "docs", platform: "github", connectionId: id, owner: "acme", repo: "docs" });
  }

  it("explains how to start when there is no destination", () => {
    render(<DestinationsSection />);
    expect(screen.getByTestId("destinations-empty")).toBeTruthy();
    expect(screen.getByText("origins.needDestination")).toBeTruthy();
  });

  it("adds, lists and removes rules; many origins can share one destination", async () => {
    seed();
    const user = userEvent.setup();
    render(<DestinationsSection />);

    async function addRule(origin: string, destination: string) {
      await user.clear(screen.getByLabelText("origins.field.origin"));
      await user.type(screen.getByLabelText("origins.field.origin"), origin);
      await user.click(screen.getByRole("combobox", { name: "origins.field.destination" }));
      await user.click(await screen.findByRole("option", { name: destination }));
      await user.click(screen.getByRole("button", { name: "origins.save" }));
    }

    await addRule("https://app.example.test", "acme/mono");
    await addRule("https://admin.example.test/", "acme/mono");
    expect(state().websiteOriginMappings).toEqual([
      { origin: "https://app.example.test", destinationId: "mono" },
      { origin: "https://admin.example.test", destinationId: "mono" },
    ]);

    await user.click(screen.getByRole("button", { name: "origins.remove.aria:https://app.example.test" }));
    expect(state().websiteOriginMappings).toEqual([{ origin: "https://admin.example.test", destinationId: "mono" }]);
  });

  it("rejects non-origin input without touching the store and flags the replacement of an existing rule", async () => {
    seed();
    state().setWebsiteOriginMapping("https://app.example.test", "mono");
    const user = userEvent.setup();
    render(<DestinationsSection />);
    const input = screen.getByLabelText("origins.field.origin");

    for (const bad of ["https://app.example.test/path", "https://*.example.test", "app.example.test"]) {
      await user.clear(input);
      await user.type(input, bad);
      expect(await screen.findByRole("alert")).toHaveProperty("textContent", "origins.error.invalid");
      expect((screen.getByRole("button", { name: "origins.save" }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(state().websiteOriginMappings).toEqual([{ origin: "https://app.example.test", destinationId: "mono" }]);

    await user.clear(input);
    await user.type(input, "HTTPS://App.Example.test/");
    expect(await screen.findByText("origins.replaces:https://app.example.test")).toBeTruthy();
  });
});

describe("DestinationsSection — destination profiles", () => {
  it("removing a destination reports and removes its website rules", async () => {
    const id = state().addConnection("github", gh("octo"));
    state().saveDestinationProfile({ id: "mono", platform: "github", connectionId: id, owner: "acme", repo: "mono" });
    state().setWebsiteOriginMapping("https://a.test", "mono");
    state().setWebsiteOriginMapping("https://b.test", "mono");
    const user = userEvent.setup();
    render(<DestinationsSection />);

    await user.click(screen.getByRole("button", { name: "destinations.remove.aria:acme/mono" }));
    expect(await screen.findByText("destinations.remove.body:2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "destinations.remove.confirm" }));

    expect(state().destinationProfiles).toEqual([]);
    expect(state().websiteOriginMappings).toEqual([]);
  });

  it("creates a GitHub destination only after picking an account and a repository, scoped to that account", async () => {
    const one = state().addConnection("github", gh("one"));
    state().addConnection("github", gh("two"));
    sendBg.mockImplementation(async (req: { connectionId?: string }) =>
      req.connectionId === one ? [repo("acme", "app")] : [repo("other", "x")],
    );
    const user = userEvent.setup();
    render(<DestinationsSection />);

    await user.click(screen.getByRole("button", { name: "destinations.add" }));
    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "common.save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await user.click(within(dialog).getByRole("radio", { name: "one" }));
    expect(save.disabled).toBe(true);
    await user.click(within(dialog).getByRole("combobox", { name: "github.section.repo" }));
    await user.click(await screen.findByText("acme/app"));
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(sendBg).toHaveBeenCalledWith({ type: "github.searchRepos", query: "", connectionId: one });

    await user.click(save);
    expect(state().destinationProfiles).toHaveLength(1);
    expect(state().destinationProfiles[0]).toMatchObject({ platform: "github", connectionId: one, owner: "acme", repo: "app" });
  });

  it("clears the repository pick when the account changes and blocks Save", async () => {
    const one = state().addConnection("github", gh("one"));
    const two = state().addConnection("github", gh("two"));
    sendBg.mockResolvedValue([repo("acme", "app")]);
    const user = userEvent.setup();
    render(<DestinationsSection />);
    await user.click(screen.getByRole("button", { name: "destinations.add" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "one" }));
    await user.click(within(dialog).getByRole("combobox", { name: "github.section.repo" }));
    await user.click(await screen.findByText("acme/app"));
    const save = within(dialog).getByRole("button", { name: "common.save" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));

    await user.click(within(dialog).getByRole("radio", { name: "two" }));
    expect(save.disabled).toBe(true);
    expect(within(dialog).getByRole("combobox", { name: "github.section.repo" }).textContent).toContain("github.field.repo.select");
    void one;
    void two;
  });

  it("blocks Linear destinations on a connection whose workspace is unverified until it is verified", async () => {
    const id = state().addConnection("linear", lin("Same Viewer"));
    sendBg.mockImplementation(async (req: { type: string }) => {
      if (req.type === "linear.getOrganization") return { id: "org-1", name: "Org One" };
      if (req.type === "linear.getTeams") return [{ id: "t1", name: "Core", key: "CORE" }];
      return [];
    });
    const user = userEvent.setup();
    render(<DestinationsSection />);
    await user.click(screen.getByRole("button", { name: "destinations.add" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "platform.tab.linear" }));
    await user.click(within(dialog).getByRole("radio", { name: "Same Viewer" }));
    expect((within(dialog).getByRole("button", { name: "common.save" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "connections.workspace.verify" }));
    await waitFor(() => expect(state().getConnection("linear", id)?.organization).toEqual({ id: "org-1", name: "Org One" }));
    expect(sendBg).toHaveBeenCalledWith({ type: "linear.getOrganization", connectionId: id });
    expect(await within(dialog).findByText("connections.workspace:Org One,org-1")).toBeTruthy();

    await user.click(within(within(dialog).getByRole("group", { name: "linear.section.team" })).getByRole("combobox"));
    await user.click(await screen.findByText("CORE — Core"));
    await user.click(within(dialog).getByRole("button", { name: "common.save" }));
    expect(state().destinationProfiles).toEqual([
      expect.objectContaining({ platform: "linear", connectionId: id, organizationId: "org-1", teamId: "t1", teamName: "Core", teamKey: "CORE" }),
    ]);
  });
});
