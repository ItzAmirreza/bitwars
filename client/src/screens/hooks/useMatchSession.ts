import { useEffect, useState } from 'react';
import type { DbConnection } from '../../module_bindings';
import { MATCH } from '../../shared-config';
import { getRemainingMs, syncServerClockOffset } from '../../serverClock';

const MATCH_STATE_WAITING = 0;
const MATCH_STATE_ACTIVE = 1;
const MATCH_STATE_ENDED = 2;

export interface MatchStanding {
  rank: number;
  identity: string;
  name: string;
  kills: number;
  deaths: number;
  kd: string;
  isYou: boolean;
}

export interface MatchVictoryResult {
  roundNumber: number;
  winnerName: string;
  winnerKills: number;
  topStandings: MatchStanding[];
  personalStanding: MatchStanding | null;
}

export interface MatchSessionState {
  phase: 'waiting' | 'active' | 'ended';
  roundNumber: number;
  timerLabel: string;
  timerText: string;
  timerCritical: boolean;
  showEndingWarning: boolean;
  endingWarningText: string;
  weaponsDisabled: boolean;
  intermissionTimerText: string;
  result: MatchVictoryResult | null;
}

interface MatchStateRow {
  roundNumber: number;
  state: number;
  phaseEndsAt?: {
    toMillis?: () => bigint | number;
  };
  timeRemainingSecs: number;
}

interface MatchResultRow {
  roundNumber: number;
  winnerName: string;
  winnerKills: number;
  playerIdentities: unknown[];
  playerNames: string[];
  playerKills: number[];
  playerDeaths: number[];
}

interface MatchTables {
  match_state?: {
    iter: () => Iterable<MatchStateRow>;
  };
  match_result?: {
    iter: () => Iterable<MatchResultRow>;
  };
}

const DEFAULT_MATCH_SESSION_STATE: MatchSessionState = {
  phase: 'waiting',
  roundNumber: 1,
  timerLabel: 'WAITING',
  timerText: '',
  timerCritical: false,
  showEndingWarning: false,
  endingWarningText: '',
  weaponsDisabled: false,
  intermissionTimerText: '',
  result: null,
};

function identityToString(value: unknown): string {
  if (value && typeof value === 'object' && 'toHexString' in value && typeof (value as { toHexString: () => string }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  return String(value ?? '');
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatKd(kills: number, deaths: number): string {
  return (kills / Math.max(1, deaths)).toFixed(2);
}

function deriveRemainingSeconds(rawState: MatchStateRow): number {
  const nowMs = Date.now();
  syncServerClockOffset(rawState, nowMs);

  const remainingMs = getRemainingMs(rawState.phaseEndsAt, nowMs);
  if (remainingMs !== null) {
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }
  return Math.max(0, Number(rawState.timeRemainingSecs ?? 0));
}

export function useMatchSession(connection: DbConnection | null, identity: string | null) {
  const [session, setSession] = useState<MatchSessionState>(DEFAULT_MATCH_SESSION_STATE);

  useEffect(() => {
    if (!connection) {
      return;
    }

    const db = connection.db as unknown as MatchTables;
    const matchStateTable = db.match_state;
    const matchResultTable = db.match_result;
    if (!matchStateTable) {
      return;
    }

    const update = () => {
      let rawState: MatchStateRow | null = null;
      for (const row of matchStateTable.iter()) {
        rawState = row;
        break;
      }

      if (!rawState) {
        setSession(DEFAULT_MATCH_SESSION_STATE);
        return;
      }

      const phaseCode = Number(rawState.state ?? MATCH_STATE_WAITING);
      const roundNumber = Number(rawState.roundNumber ?? 1);
      const remainingSeconds = deriveRemainingSeconds(rawState);
      const phase = phaseCode === MATCH_STATE_ACTIVE
        ? 'active'
        : phaseCode === MATCH_STATE_ENDED
          ? 'ended'
          : 'waiting';

      let result: MatchVictoryResult | null = null;
      if (phaseCode === MATCH_STATE_ENDED && matchResultTable) {
        let latestResult: MatchResultRow | null = null;
        for (const row of matchResultTable.iter()) {
          if (!latestResult || Number(row.roundNumber ?? 0) > Number(latestResult.roundNumber ?? 0)) {
            latestResult = row;
          }
        }

        if (latestResult && Number(latestResult.roundNumber ?? 0) === roundNumber) {
          const identities = Array.isArray(latestResult.playerIdentities) ? latestResult.playerIdentities : [];
          const names = Array.isArray(latestResult.playerNames) ? latestResult.playerNames : [];
          const kills = Array.isArray(latestResult.playerKills) ? latestResult.playerKills : [];
          const deaths = Array.isArray(latestResult.playerDeaths) ? latestResult.playerDeaths : [];
          const standings: MatchStanding[] = names.map((name: string, index: number) => {
            const standingIdentity = identityToString(identities[index]);
            const standingKills = Number(kills[index] ?? 0);
            const standingDeaths = Number(deaths[index] ?? 0);
            return {
              rank: index + 1,
              identity: standingIdentity,
              name,
              kills: standingKills,
              deaths: standingDeaths,
              kd: formatKd(standingKills, standingDeaths),
              isYou: !!identity && standingIdentity === identity,
            };
          });

          result = {
            roundNumber,
            winnerName: String(latestResult.winnerName ?? 'NO WINNER'),
            winnerKills: Number(latestResult.winnerKills ?? 0),
            topStandings: standings.slice(0, 5),
            personalStanding: standings.find((standing) => standing.isYou) ?? null,
          };
        }
      }

      setSession({
        phase,
        roundNumber,
        timerLabel: phaseCode === MATCH_STATE_ACTIVE
          ? `ROUND ${roundNumber}`
          : phaseCode === MATCH_STATE_ENDED
            ? 'INTERMISSION'
            : 'WAITING',
        timerText: phaseCode === MATCH_STATE_WAITING ? '' : formatCountdown(remainingSeconds),
        timerCritical: phaseCode === MATCH_STATE_ACTIVE && remainingSeconds <= MATCH.endingWarningSecs,
        showEndingWarning: phaseCode === MATCH_STATE_ACTIVE && remainingSeconds > 0 && remainingSeconds <= MATCH.endingWarningSecs,
        endingWarningText: `MATCH ENDING IN ${remainingSeconds}S`,
        weaponsDisabled: phaseCode !== MATCH_STATE_ACTIVE,
        intermissionTimerText: phaseCode === MATCH_STATE_ENDED ? formatCountdown(remainingSeconds) : '',
        result,
      });
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [connection, identity]);

  return connection ? session : DEFAULT_MATCH_SESSION_STATE;
}
