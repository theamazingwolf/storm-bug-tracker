import { describe, expect, it, vi } from "vitest";
import { createConnectionRefreshFlights } from "../connectionRefreshFlights";

describe("connection-scoped refresh flights", () => {
  it("coalesces refreshes only for the same connection and grant", async () => {
    const run = createConnectionRefreshFlights<string>();
    const first = vi.fn(async () => "rotated-1");
    const second = vi.fn(async () => "rotated-2");
    const third = vi.fn(async () => "rotated-3");
    const [a, sameGrant, otherConnection, newGrant] = await Promise.all([
      run("gh-1", "grant-1", first),
      run("gh-1", "grant-1", second),
      run("gh-2", "grant-1", second),
      run("gh-1", "grant-2", third),
    ]);
    expect([a, sameGrant, otherConnection, newGrant]).toEqual(["rotated-1", "rotated-1", "rotated-2", "rotated-3"]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("clears rejected flights so a later retry can run", async () => {
    const run = createConnectionRefreshFlights<string>();
    await expect(run("lin-1", "grant-1", async () => { throw new Error("refresh failed"); })).rejects.toThrow("refresh failed");
    await expect(run("lin-1", "grant-1", async () => "recovered")).resolves.toBe("recovered");
  });
});
