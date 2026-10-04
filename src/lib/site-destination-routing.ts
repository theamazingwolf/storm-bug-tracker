import type { DestinationProfile, WebsiteOriginMapping } from "@/types/connection";

export type WebsiteOriginMatch =
  | { status: "matched"; destination: DestinationProfile }
  | { status: "unmatched" }
  | { status: "ambiguous"; destinations: DestinationProfile[] }
  | { status: "unsupported" };

/** Extracts the canonical HTTP(S) origin from a page URL; paths never participate in matching. */
export function normalizeWebsiteOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(input)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeMappingOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return normalizeWebsiteOrigin(input);
  } catch {
    return null;
  }
}

export function matchWebsiteOrigin(
  websiteUrl: string,
  mappings: readonly WebsiteOriginMapping[],
  destinations: readonly DestinationProfile[],
): WebsiteOriginMatch {
  const origin = normalizeWebsiteOrigin(websiteUrl);
  if (!origin) return { status: "unsupported" };

  const matchingIds = new Set<string>();
  for (const mapping of mappings) {
    const mappedOrigin = normalizeMappingOrigin(mapping.origin);
    if (!mappedOrigin || mappedOrigin !== origin) continue;
    matchingIds.add(mapping.destinationId);
  }
  if (matchingIds.size === 0) return { status: "unmatched" };

  const profiles = [...matchingIds].map((id) => destinations.find((item) => item.id === id));
  if (profiles.some((profile) => !profile)) return { status: "unsupported" };
  const matched = profiles as DestinationProfile[];
  if (matched.length > 1) return { status: "ambiguous", destinations: matched };
  return { status: "matched", destination: matched[0] };
}
