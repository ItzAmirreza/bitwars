const JAM_PORTAL_URL = "https://jam.pieter.com/portal/2026";

const FORWARDED_PARAM_KEYS = [
  "username",
  "color",
  "speed",
  "avatar_url",
  "team",
  "hp",
  "speed_x",
  "speed_y",
  "speed_z",
  "rotation_x",
  "rotation_y",
  "rotation_z",
] as const;

const PORTAL_ADJECTIVES = [
  "amber",
  "aqua",
  "ash",
  "azure",
  "birch",
  "blue",
  "bold",
  "brisk",
  "bronze",
  "calm",
  "cedar",
  "clear",
  "cloud",
  "cobalt",
  "coral",
  "crisp",
  "dawn",
  "drift",
  "dune",
  "ember",
  "fern",
  "flint",
  "frost",
  "ghost",
  "glade",
  "gold",
  "granite",
  "green",
  "hazel",
  "hollow",
  "indigo",
  "ivory",
  "jade",
  "lilac",
  "lunar",
  "maple",
  "meadow",
  "mist",
  "moss",
  "navy",
  "nova",
  "ocean",
  "olive",
  "opal",
  "pearl",
  "pine",
  "plum",
  "quiet",
  "rain",
  "river",
  "rose",
  "ruby",
  "sage",
  "scarlet",
  "silver",
  "sky",
  "slate",
  "solar",
  "spruce",
  "stone",
  "sun",
  "swift",
  "teal",
  "velvet",
] as const;

const PORTAL_NOUNS = [
  "antler",
  "badger",
  "beacon",
  "bear",
  "bloom",
  "brook",
  "cedar",
  "cloud",
  "comet",
  "creek",
  "crow",
  "dawn",
  "dune",
  "falcon",
  "field",
  "finch",
  "flame",
  "flower",
  "fox",
  "glade",
  "glen",
  "grove",
  "harbor",
  "hawk",
  "heron",
  "hill",
  "ibis",
  "isle",
  "lake",
  "lark",
  "lion",
  "lynx",
  "maple",
  "marsh",
  "meadow",
  "moon",
  "otter",
  "owl",
  "pine",
  "raven",
  "reed",
  "ridge",
  "river",
  "robin",
  "rose",
  "shadow",
  "shore",
  "spark",
  "spruce",
  "star",
  "stone",
  "storm",
  "sun",
  "surf",
  "swan",
  "tide",
  "trail",
  "vale",
  "wave",
  "whale",
  "willow",
  "wind",
  "wolf",
  "wren",
] as const;

export interface PortalContext {
  isPortalArrival: boolean;
  refUrl: string | null;
  refLabel: string | null;
  incomingUsername: string | null;
  forwardedParams: Map<string, string>;
}

interface PortalTravelState {
  username?: string | null;
  hp?: number | null;
  speed?: number | null;
}

function sanitizePortalUsername(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 20) : null;
}

function normalizeRefUrl(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const normalized = trimmed.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
      ? new URL(trimmed)
      : new URL(`https://${trimmed.replace(/^\/\//, "")}`);
    if (normalized.protocol !== "http:" && normalized.protocol !== "https:") {
      return null;
    }
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return null;
  }
}

function normalizeRefLabel(refUrl: string | null): string | null {
  if (!refUrl) return null;
  try {
    const url = new URL(refUrl);
    return url.hostname || url.host || refUrl;
  } catch {
    return refUrl;
  }
}

export function getCurrentGameBaseUrl(): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function getPortalContext(): PortalContext {
  const params = new URLSearchParams(window.location.search);
  const forwardedParams = new Map<string, string>();
  for (const key of FORWARDED_PARAM_KEYS) {
    const value = params.get(key);
    if (value) {
      forwardedParams.set(key, value);
    }
  }

  const refUrl = normalizeRefUrl(params.get("ref"));
  const incomingUsername =
    sanitizePortalUsername(params.get("username")) ??
    sanitizePortalUsername(forwardedParams.get("username") ?? null);

  return {
    isPortalArrival: params.get("portal") === "true" || params.has("portal"),
    refUrl,
    refLabel: normalizeRefLabel(refUrl),
    incomingUsername,
    forwardedParams,
  };
}

function pushCandidate(
  candidates: string[],
  seen: Set<string>,
  value: string,
): void {
  const trimmed = value.trim().slice(0, 20);
  if (!trimmed) return;
  const key = trimmed.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(trimmed);
}

function identityBytes(identity: string | null): number[] {
  const compact = (identity ?? "portal-user").replace(/[^a-fA-F0-9]/g, "");
  if (compact.length >= 2 && compact.length % 2 === 0) {
    const bytes: number[] = [];
    for (let i = 0; i < compact.length; i += 2) {
      bytes.push(Number.parseInt(compact.slice(i, i + 2), 16));
    }
    if (bytes.length > 0) {
      return bytes;
    }
  }

  return Array.from(identity ?? "portal-user").map((char, index) =>
    (char.charCodeAt(0) + index * 17) & 0xff
  );
}

function portalWordTag(identity: string | null, variant: number): string {
  const bytes = identityBytes(identity);
  const byte = (offset: number) => bytes[(variant * 3 + offset) % bytes.length] ?? 0;
  const adjectiveSeed = byte(0) ^ byte(5);
  const nounSeed = (byte(1) + byte(3) * 3 + byte(7)) & 0xff;
  const adjective = PORTAL_ADJECTIVES[adjectiveSeed % PORTAL_ADJECTIVES.length];
  const noun = PORTAL_NOUNS[nounSeed % PORTAL_NOUNS.length];
  return `${adjective}-${noun}`;
}

function withSuffix(base: string, suffix: string): string {
  const safeSuffix = suffix.trim().slice(0, 14);
  if (!safeSuffix) return base.slice(0, 20);
  const rootBudget = Math.max(1, 20 - safeSuffix.length - 1);
  const root = (base.trim().slice(0, rootBudget) || "Pilot").trim();
  return `${root}-${safeSuffix}`.slice(0, 20);
}

export function getPortalUsernameCandidates(
  context: PortalContext,
  identity: string | null,
): string[] {
  const base = context.incomingUsername ?? "Portal";
  const candidates: string[] = [];
  const seen = new Set<string>();

  pushCandidate(candidates, seen, withSuffix(base, portalWordTag(identity, 0)));
  pushCandidate(candidates, seen, withSuffix(base, portalWordTag(identity, 1)));
  pushCandidate(candidates, seen, withSuffix("Portal", portalWordTag(identity, 2)));
  pushCandidate(candidates, seen, withSuffix("Pilot", portalWordTag(identity, 3)));

  return candidates;
}

export function getPortalSuggestedUsername(identity: string | null = null): string {
  const context = getPortalContext();
  return getPortalUsernameCandidates(context, identity)[0] ?? "";
}

function applyTravelState(
  searchParams: URLSearchParams,
  state: PortalTravelState,
): void {
  if (state.username) {
    searchParams.set("username", state.username);
  }
  if (typeof state.hp === "number" && Number.isFinite(state.hp)) {
    searchParams.set("hp", String(Math.max(0, Math.round(state.hp))));
  }
  if (typeof state.speed === "number" && Number.isFinite(state.speed)) {
    searchParams.set("speed", state.speed.toFixed(1));
  }
}

export function buildJamPortalUrl(state: PortalTravelState): string {
  const url = new URL(JAM_PORTAL_URL);
  applyTravelState(url.searchParams, state);
  url.searchParams.set("ref", getCurrentGameBaseUrl());
  return url.toString();
}

export function buildReturnPortalUrl(
  context: PortalContext,
  state: PortalTravelState,
): string | null {
  if (!context.refUrl) return null;

  const url = new URL(context.refUrl);
  for (const [key, value] of context.forwardedParams) {
    url.searchParams.set(key, value);
  }
  applyTravelState(url.searchParams, state);
  url.searchParams.set("portal", "true");
  url.searchParams.set("ref", getCurrentGameBaseUrl());
  return url.toString();
}
