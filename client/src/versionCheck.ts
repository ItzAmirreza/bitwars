declare const __GIT_COMMIT__: string;

export const CLIENT_BUILD_HASH: string =
  typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'dev';

export function isVersionMismatch(serverBuildHash: string): boolean {
  if (CLIENT_BUILD_HASH === 'dev' || serverBuildHash === 'unknown') return false;
  return CLIENT_BUILD_HASH !== serverBuildHash;
}
