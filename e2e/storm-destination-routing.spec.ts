import { enterDebug, expect, test, type ExtContext } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// All account values and pages are synthetic. External DNS is denied in addition
// to intercepting provider traffic, including any service-worker-owned requests.
test.use({ localOnly: true });
test.describe("Storm destination capture smoke", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeEach(async ({ ext }) => {
    await ext.evalInExt(async () => {
      await chrome.storage.local.clear();
      await chrome.storage.session.clear();
    });
    await ext.context.route("https://api.github.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
  });

  test.afterEach(async ({ ext }) => {
    await panel?.close();
    await fixture?.close();
    await ext.context.unroute("https://api.github.com/**");
  });

  async function openCapture(ext: ExtContext) {
    panel = await ext.openPanel(await ext.fixtureTabId());
    await enterDebug(panel);
    await panel.getByTestId("subtab-issue").click();
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await panel.getByTestId("draft-title").fill("Synthetic destination smoke");
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("issue-submit-open")).toBeVisible();
    await panel.getByTestId("issue-submit-open").click();
    await expect(panel.getByTestId("submit-fields-dialog")).toBeVisible();
  }

  test("first-run capture reaches both inline connections and retains the draft on cancel", async ({ ext }) => {
    await openCapture(ext);
    const dialog = panel.getByTestId("submit-fields-dialog");
    await expect(dialog.getByTestId("platform-tab-github")).toBeVisible();
    await expect(dialog.getByTestId("platform-tab-linear")).toBeVisible();
    await expect(dialog.locator("#destination-connection")).toBeVisible();
    await expect(dialog.locator("#destination-connection option")).toHaveCount(1);
    await expect(dialog.getByTestId("submit-issue-confirm")).toBeDisabled();
    await dialog.getByTestId("platform-tab-linear").click();
    await expect(dialog.locator("#destination-connection")).toBeVisible();
    await expect(dialog.getByTestId("submit-issue-confirm")).toBeDisabled();
    await panel.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(panel.getByTestId("issue-submit-open")).toBeVisible();

    // Restored, unbound drafts must also offer inline setup without inventing a binding.
    await panel.close();
    panel = await ext.openPanel(await ext.fixtureTabId());
    await panel.getByTestId("tab-issue-list").click();
    await panel.getByTestId("issue-row").filter({ hasText: "Synthetic destination smoke" }).click();
    await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
    await panel.getByTestId("detail-submit-open").click();
    await expect(panel.locator("#destination-connection")).toBeVisible();
    await expect(panel.locator("#capture-destination")).toHaveValue("");
    await expect(panel.getByTestId("submit-issue-confirm")).toBeDisabled();
  });

  test("origin chooses the bound account, while profile edits and reopen retain the original target", async ({ ext }) => {
    const origin = new URL(fixture.url()).origin;
    await ext.evalInExt(async (origin) => {
      const connection = (id: string) => ({
        id, platform: "github",
        account: { platform: "github", connectedAt: 1,
          auth: { kind: "pat", pat: "synthetic-not-a-token", viewerLogin: id, viewerId: id === "account-a" ? 1 : 2 },
          defaults: {} },
      });
      const first = connection("account-a");
      const second = connection("account-b");
      await chrome.storage.local.set({
        "bugshot-settings": JSON.stringify({ version: 13, state: {
          accounts: { github: second.account }, connections: { github: [first, second], linear: [] },
          selectedConnectionIds: { github: second.id }, lastSubmitFields: {},
          destinationProfiles: [{ id: "profile-a", platform: "github", connectionId: first.id, owner: "synthetic-org", repo: "original-repo" }],
          websiteOriginMappings: [{ origin, destinationId: "profile-a" }],
        } }),
      });
    }, origin);
    await openCapture(ext);
    const picker = panel.locator("#capture-destination");
    await expect(picker).toHaveValue("saved:profile-a");
    await expect(picker.locator("option:checked")).toContainText("original-repo");
    const selected = await ext.evalInExt(async () => {
      const raw = await chrome.storage.local.get("bugshot-settings");
      return JSON.parse(raw["bugshot-settings"]).state.selectedConnectionIds.github;
    });
    expect(selected).toBe("account-b");

    await ext.evalInExt(async () => {
      const raw = await chrome.storage.local.get("bugshot-settings");
      const saved = JSON.parse(raw["bugshot-settings"]);
      saved.state.destinationProfiles[0].repo = "edited-repo";
      await chrome.storage.local.set({ "bugshot-settings": JSON.stringify(saved) });
    });
    await expect(picker).toHaveValue("snapshot:profile-a");
    await expect(picker.locator("option:checked")).toContainText("original-repo");
    await panel.keyboard.press("Escape");
    await panel.getByTestId("issue-submit-open").click();
    await expect(picker).toHaveValue("snapshot:profile-a");
    await expect(picker.locator("option:checked")).toContainText("original-repo");
    await picker.selectOption("saved:profile-a");
    await expect(picker.locator("option:checked")).toContainText("edited-repo");

    // Removing the bound account must not switch the draft to the still-selected account B.
    await ext.evalInExt(async () => {
      const raw = await chrome.storage.local.get("bugshot-settings");
      const saved = JSON.parse(raw["bugshot-settings"]);
      saved.state.connections.github = saved.state.connections.github.filter((entry: { id: string }) => entry.id !== "account-a");
      await chrome.storage.local.set({ "bugshot-settings": JSON.stringify(saved) });
    });
    await expect(panel.getByTestId("submit-issue-confirm")).toBeDisabled();
    await expect(picker.locator("option:checked")).toContainText("edited-repo");
  });
});
