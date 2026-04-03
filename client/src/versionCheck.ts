declare const __GIT_COMMIT__: string;
declare const __EXPECTED_SERVER_BUILD__: string;

export const BUILD_META_PATH = "/bitwars-build.json";

export interface BuildMeta {
  clientBuild: string;
  expectedServerBuild: string;
  gitBranch: string;
  gitCommit: string;
  sampledAt: string;
}

function normalizeBuildHash(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "unknown";
  if (trimmed === "dev" || trimmed === "unknown") return trimmed;
  return trimmed.slice(0, 7);
}

export const CLIENT_BUILD_HASH: string = normalizeBuildHash(
  typeof __GIT_COMMIT__ !== "undefined" ? __GIT_COMMIT__ : "dev",
);

export const EXPECTED_SERVER_BUILD_HASH: string = normalizeBuildHash(
  typeof __EXPECTED_SERVER_BUILD__ !== "undefined"
    ? __EXPECTED_SERVER_BUILD__
    : "unknown",
);

function hasKnownBuildHash(value: string): boolean {
  return value !== "dev" && value !== "unknown";
}

export function isServerBuildCompatible(serverBuildHash: string): boolean {
  if (import.meta.env.DEV) return true;

  const normalizedServerBuild = normalizeBuildHash(serverBuildHash);
  if (
    !hasKnownBuildHash(EXPECTED_SERVER_BUILD_HASH) ||
    !hasKnownBuildHash(normalizedServerBuild)
  ) {
    return true;
  }

  return EXPECTED_SERVER_BUILD_HASH === normalizedServerBuild;
}

function isBuildMeta(value: unknown): value is BuildMeta {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.clientBuild === "string" &&
    typeof candidate.expectedServerBuild === "string" &&
    typeof candidate.gitBranch === "string" &&
    typeof candidate.gitCommit === "string" &&
    typeof candidate.sampledAt === "string"
  );
}

export async function fetchLatestBuildMeta(
  signal?: AbortSignal,
): Promise<BuildMeta | null> {
  if (import.meta.env.DEV) return null;

  try {
    const response = await fetch(`${BUILD_META_PATH}?ts=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
      signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    if (!isBuildMeta(payload)) return null;

    return {
      clientBuild: normalizeBuildHash(payload.clientBuild),
      expectedServerBuild: normalizeBuildHash(payload.expectedServerBuild),
      gitBranch: payload.gitBranch,
      gitCommit: normalizeBuildHash(payload.gitCommit),
      sampledAt: payload.sampledAt,
    };
  } catch {
    return null;
  }
}

export function hasNewClientBuild(meta: BuildMeta): boolean {
  if (
    !hasKnownBuildHash(CLIENT_BUILD_HASH) ||
    !hasKnownBuildHash(meta.clientBuild)
  ) {
    return false;
  }

  return meta.clientBuild !== CLIENT_BUILD_HASH;
}
