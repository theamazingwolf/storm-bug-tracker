import { describe, expect, it } from "vitest";
import type { DestinationProfile, WebsiteOriginMapping } from "@/types/connection";
import { matchWebsiteOrigin, normalizeWebsiteOrigin } from "../site-destination-routing";

const github: DestinationProfile = { id: "repo-1", platform: "github", connectionId: "gh-1", owner: "acme", repo: "mono" };
const linear: DestinationProfile = { id: "team-1", platform: "linear", connectionId: "lin-1", organizationId: "org-1", teamId: "team-1" };
const rules = (...origins: string[]): WebsiteOriginMapping[] => origins.map((origin) => ({ origin, destinationId: github.id }));

describe("website origin routing", () => {
  it("canonicalizes exact scheme/host/effective port, including default ports and case", () => {
    expect(normalizeWebsiteOrigin("HTTPS://Example.COM:443/")).toBe("https://example.com");
    expect(normalizeWebsiteOrigin("http://LOCALHOST:80")).toBe("http://localhost");
    expect(normalizeWebsiteOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeWebsiteOrigin("https://example.com:8443")).toBe("https://example.com:8443");
  });

  it("supports many exact origins routing to one repository profile", () => {
    const result = matchWebsiteOrigin("https://a.example", rules("https://a.example", "https://b.example"), [github]);
    expect(result).toEqual({ status: "matched", destination: github });
  });

  it("reports ambiguous conflicting mappings and unmatched exact origins", () => {
    expect(matchWebsiteOrigin("https://a.example", [
      { origin: "https://a.example", destinationId: github.id },
      { origin: "https://a.example", destinationId: linear.id },
    ], [github, linear])).toMatchObject({ status: "ambiguous", destinations: [github, linear] });
    expect(matchWebsiteOrigin("https://elsewhere.example", rules("https://a.example"), [github])).toEqual({ status: "unmatched" });
  });

  it("matches page paths by origin, rejects malformed/credentialed/unsupported URLs, and never suffix-matches", () => {
    for (const input of ["not a url", "https://user:pass@example.com", "ftp://example.com"]) {
      expect(matchWebsiteOrigin(input, rules("https://example.com"), [github]).status, input).toBe("unsupported");
    }
    expect(matchWebsiteOrigin("https://example.com/path?x=1#frag", rules("https://example.com"), [github])).toEqual({ status: "matched", destination: github });
    expect(matchWebsiteOrigin("https://notexample.com", rules("https://example.com"), [github])).toEqual({ status: "unmatched"});
    expect(matchWebsiteOrigin("https://example.com", rules("https://example.com/path", "https://example.com?x=1", "https://example.com#frag"), [github])).toEqual({ status: "unmatched" });
  });

  it("treats conflicting records for a missing destination as unsupported, not a guessed route", () => {
    const bad = [{ origin: "https://a.example", destinationId: "missing" }];
    expect(matchWebsiteOrigin("https://a.example", bad, [github])).toEqual({ status: "unsupported" });
  });
});
