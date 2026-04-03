declare const __GIT_COMMIT__: string;

export const CLIENT_BUILD_HASH: string =
  typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'dev';

function hasKnownBuildHash(value: string): boolean {
  return value !== 'dev' && value !== 'unknown';
}

export function isVersionMismatch(serverBuildHash: string): boolean {
  if (import.meta.env.DEV) return false;
  if (!hasKnownBuildHash(CLIENT_BUILD_HASH) || !hasKnownBuildHash(serverBuildHash)) {
    return false;
  }
  return CLIENT_BUILD_HASH !== serverBuildHash;
}
