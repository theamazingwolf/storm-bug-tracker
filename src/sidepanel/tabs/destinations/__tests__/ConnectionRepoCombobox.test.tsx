import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));

const sendBg = vi.fn();
vi.mock("@/lib/bg-client", () => ({ sendBg: (req: unknown) => sendBg(req) }));

import { ConnectionRepoCombobox } from "../ConnectionRepoCombobox";

function repo(owner: string, name: string) {
  return { id: 1, nodeId: "n", owner, name, fullName: `${owner}/${name}`, private: false, htmlUrl: "", hasIssues: true, archived: false };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe("ConnectionRepoCombobox", () => {
  it("is disabled and sends nothing without a connection id", async () => {
    render(<ConnectionRepoCombobox connectionId={undefined} value={null} onChange={vi.fn()} ariaLabel="repo" />);
    const trigger = screen.getByRole("combobox", { name: "repo" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(sendBg).not.toHaveBeenCalled();
  });

  it("scopes every search to the connection and discards a late response from the previous connection", async () => {
    const a = deferred<ReturnType<typeof repo>[]>();
    const b = deferred<ReturnType<typeof repo>[]>();
    sendBg.mockImplementation((req: { connectionId: string }) => (req.connectionId === "a" ? a.promise : b.promise));
    const user = userEvent.setup();
    const { rerender } = render(<ConnectionRepoCombobox connectionId="a" value={null} onChange={vi.fn()} ariaLabel="repo" />);

    await user.click(screen.getByRole("combobox", { name: "repo" }));
    await waitFor(() => expect(sendBg).toHaveBeenCalledWith({ type: "github.searchRepos", query: "", connectionId: "a" }));

    rerender(<ConnectionRepoCombobox connectionId="b" value={null} onChange={vi.fn()} ariaLabel="repo" />);
    await waitFor(() => expect(sendBg).toHaveBeenCalledWith({ type: "github.searchRepos", query: "", connectionId: "b" }));

    await act(async () => {
      b.resolve([repo("org-b", "app")]);
    });
    await screen.findByText("org-b/app");
    await act(async () => {
      a.resolve([repo("org-a", "secret")]);
    });
    expect(screen.queryByText("org-a/secret")).toBeNull();
    expect(screen.getByText("org-b/app")).toBeTruthy();
    for (const [req] of sendBg.mock.calls) expect(req.connectionId).toMatch(/^[ab]$/);
  });

  it("clears the previous account's list when the connection changes", async () => {
    sendBg.mockResolvedValueOnce([repo("org-a", "one")]).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const { rerender } = render(<ConnectionRepoCombobox connectionId="a" value={null} onChange={vi.fn()} ariaLabel="repo" />);
    await user.click(screen.getByRole("combobox", { name: "repo" }));
    await screen.findByText("org-a/one");
    rerender(<ConnectionRepoCombobox connectionId="b" value={null} onChange={vi.fn()} ariaLabel="repo" />);
    await waitFor(() => expect(screen.queryByText("org-a/one")).toBeNull());
  });
});
