interface TimestampLike {
  toMillis?: () => bigint | number;
}

interface MatchStateLike {
  phaseEndsAt?: TimestampLike | null;
  timeRemainingSecs?: number | null;
}

let serverClockOffsetMs = 0;
let hasServerClockOffset = false;

export function readTimestampMs(timestamp: TimestampLike | null | undefined): number | null {
  if (!timestamp || typeof timestamp.toMillis !== 'function') {
    return null;
  }

  const value = Number(timestamp.toMillis());
  return Number.isFinite(value) ? value : null;
}

export function syncServerClockOffset(matchState: MatchStateLike | null | undefined, nowMs = Date.now()): number | null {
  const endsAtMs = readTimestampMs(matchState?.phaseEndsAt);
  const remainingSeconds = Number(matchState?.timeRemainingSecs ?? NaN);
  if (endsAtMs === null || !Number.isFinite(remainingSeconds) || remainingSeconds < 0) {
    return hasServerClockOffset ? serverClockOffsetMs : null;
  }

  const inferredServerNowMs = endsAtMs - Math.max(0, remainingSeconds) * 1000;
  const nextOffsetMs = inferredServerNowMs - nowMs;

  if (!hasServerClockOffset || Math.abs(nextOffsetMs - serverClockOffsetMs) > 30_000) {
    serverClockOffsetMs = nextOffsetMs;
  } else {
    serverClockOffsetMs = serverClockOffsetMs * 0.8 + nextOffsetMs * 0.2;
  }

  hasServerClockOffset = true;
  return serverClockOffsetMs;
}

export function getServerNowMs(nowMs = Date.now()): number {
  return nowMs + serverClockOffsetMs;
}

export function getRemainingMs(timestamp: TimestampLike | null | undefined, nowMs = Date.now()): number | null {
  const timestampMs = readTimestampMs(timestamp);
  if (timestampMs === null) {
    return null;
  }
  return timestampMs - getServerNowMs(nowMs);
}
