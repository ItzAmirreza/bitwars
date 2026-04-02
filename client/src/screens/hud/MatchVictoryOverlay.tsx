import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { MatchVictoryResult } from '../hooks/useMatchSession';

interface MatchVictoryOverlayProps {
  result: MatchVictoryResult;
  nextRoundTimer: string;
}

const tableCellStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  color: '#e8e8f0',
  padding: '6px 0',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

export function MatchVictoryOverlay({ result, nextRoundTimer }: MatchVictoryOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
      style={{ background: 'rgba(8,10,18,0.42)' }}
    >
      <div
        style={{
          width: 'min(760px, calc(100vw - 32px))',
          border: '2px solid #ff6b35',
          background: 'linear-gradient(180deg, rgba(13,18,28,0.94) 0%, rgba(9,12,20,0.92) 100%)',
          boxShadow: '0 22px 80px rgba(0,0,0,0.45)',
          padding: '22px 22px 18px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '16px',
            alignItems: 'flex-start',
            marginBottom: '18px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '8px',
                letterSpacing: '0.2em',
                color: '#ffb38f',
                marginBottom: '8px',
              }}
            >
              ROUND {result.roundNumber} COMPLETE
            </div>
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '22px',
                letterSpacing: '0.08em',
                color: '#fff',
                textShadow: '3px 3px 0 rgba(255,107,53,0.45)',
              }}
            >
              {result.winnerName}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: '#ff6b35',
                marginTop: '6px',
                letterSpacing: '0.08em',
              }}
            >
              {result.winnerKills} KILLS
            </div>
          </div>

          <div
            style={{
              minWidth: '180px',
              border: '2px solid #1a1e2e',
              background: 'rgba(5,8,14,0.62)',
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '7px',
                letterSpacing: '0.14em',
                color: '#6b7080',
                marginBottom: '8px',
              }}
            >
              NEXT ROUND
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#00e5ff',
                lineHeight: '1',
              }}
            >
              {nextRoundTimer}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '6px',
                letterSpacing: '0.12em',
                color: '#6b7080',
                marginTop: '8px',
              }}
            >
              WEAPONS DISABLED
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.2fr) minmax(240px, 0.8fr)',
            gap: '16px',
          }}
        >
          <div
            style={{
              border: '2px solid #1a1e2e',
              background: 'rgba(5,8,14,0.58)',
              padding: '12px 14px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '7px',
                letterSpacing: '0.14em',
                color: '#6b7080',
                marginBottom: '10px',
              }}
            >
              TOP 5 LEADERBOARD
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '48px minmax(0, 1fr) 56px 56px 62px',
                gap: '10px',
                alignItems: 'center',
              }}
            >
              {['RANK', 'PLAYER', 'K', 'D', 'K/D'].map((label) => (
                <div
                  key={label}
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '6px',
                    color: '#6b7080',
                    letterSpacing: '0.14em',
                  }}
                >
                  {label}
                </div>
              ))}
              {result.topStandings.map((standing) => (
                <Fragment key={standing.identity || String(standing.rank)}>
                  <div key={`${standing.rank}-rank`} style={tableCellStyle}>#{standing.rank}</div>
                  <div
                    key={`${standing.rank}-name`}
                    style={{
                      ...tableCellStyle,
                      color: standing.isYou ? '#00e5ff' : '#e8e8f0',
                      fontWeight: standing.isYou ? 'bold' : 'normal',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {standing.name}
                  </div>
                  <div key={`${standing.rank}-kills`} style={tableCellStyle}>{standing.kills}</div>
                  <div key={`${standing.rank}-deaths`} style={tableCellStyle}>{standing.deaths}</div>
                  <div key={`${standing.rank}-kd`} style={tableCellStyle}>{standing.kd}</div>
                </Fragment>
              ))}
            </div>
          </div>

          <div
            style={{
              border: '2px solid #1a1e2e',
              background: 'rgba(5,8,14,0.58)',
              padding: '12px 14px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '7px',
                letterSpacing: '0.14em',
                color: '#6b7080',
                marginBottom: '12px',
              }}
            >
              YOUR ROUND
            </div>
            {result.personalStanding ? (
              <>
                <div
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '12px',
                    letterSpacing: '0.08em',
                    color: '#00e5ff',
                    marginBottom: '12px',
                  }}
                >
                  #{result.personalStanding.rank} {result.personalStanding.name}
                </div>
                {[
                  ['Kills', result.personalStanding.kills],
                  ['Deaths', result.personalStanding.deaths],
                  ['K/D', result.personalStanding.kd],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: '#e8e8f0',
                      padding: '8px 0',
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <span style={{ color: '#6b7080' }}>{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </>
            ) : (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: '#e8e8f0',
                }}
              >
                No round stats recorded.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
