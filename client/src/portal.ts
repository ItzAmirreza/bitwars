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

function identitySuffix(identity: string | null): string {
  if (!identity) return "PORTAL";
  const compact = identity.replace(/[^a-fA-F0-9]/g, "");
  const suffix = compact.slice(-8).toUpperCase();
  return suffix || "PORTAL";
}

function withSuffix(base: string, suffix: string): string {
  const safeSuffix = suffix.trim().slice(0, 8);
  if (!safeSuffix) return base.slice(0, 20);
  const rootBudget = Math.max(1, 20 - safeSuffix.length - 1);
  const root = (base.trim().slice(0, rootBudget) || "Pilot").trim();
  return `${root}-${safeSuffix}`.slice(0, 20);
}

export function getPortalUsernameCandidates(
  context: PortalContext,
  identity: string | null,
): string[] {
  const base = context.incomingUsername ?? "Portal Pilot";
  const suffix = identitySuffix(identity);
  const candidates: string[] = [];
  const seen = new Set<string>();

  pushCandidate(candidates, seen, withSuffix(base, suffix));
  pushCandidate(candidates, seen, withSuffix("Portal", suffix));
  pushCandidate(candidates, seen, withSuffix("Pilot", suffix));
  pushCandidate(candidates, seen, `P-${suffix}`);

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
