import type { CSSProperties } from 'react';
import type { TacticalMapSnapshot } from '../hooks/useTacticalMap';

interface TacticalMinimapProps {
  snapshot: TacticalMapSnapshot;
  heading: number;
  side: 'left' | 'right';
}

interface TacticalMapOverlayProps {
  open: boolean;
  snapshot: TacticalMapSnapshot;
  heading: number;
}

type TacticalMapVariant = 'mini' | 'full';

function toPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function markerTransform(x: number, y: number): CSSProperties {
  return {
    position: 'absolute',
    left: `${x}%`,
    top: `${y}%`,
    transform: 'translate(-50%, -50%)',
  };
}

function MapFrame({
  variant,
  snapshot,
  heading,
  side = 'left',
}: {
  variant: TacticalMapVariant;
  snapshot: TacticalMapSnapshot;
  heading: number;
  side?: 'left' | 'right';
}) {
  const mini = variant === 'mini';
  const labelPlayers = !mini || snapshot.players.length <= 10;
  const headerAccent = mini ? '#7cf6ff' : '#ff8f5a';
  const shellStyle: CSSProperties = mini
    ? {
        position: 'absolute',
        top: '76px',
        ...(side === 'left' ? { left: '18px' } : { right: '18px' }),
        zIndex: 12,
        width: '224px',
        pointerEvents: 'none',
      }
    : {
        position: 'absolute',
        inset: '76px 24px 24px',
        zIndex: 24,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
      };

  const panelStyle: CSSProperties = mini
    ? {
        position: 'relative',
        border: '1px solid rgba(124,246,255,0.28)',
        background: 'linear-gradient(180deg, rgba(9,16,26,0.96), rgba(6,10,18,0.92))',
        boxShadow: '0 24px 48px rgba(0,0,0,0.32), inset 0 0 0 1px rgba(255,255,255,0.04)',
        backdropFilter: 'blur(10px)',
        padding: '10px',
      }
    : {
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 220px',
        gap: '18px',
        width: 'min(1100px, 100%)',
        padding: '18px',
        border: '1px solid rgba(255,143,90,0.26)',
        background: 'linear-gradient(180deg, rgba(9,16,26,0.98), rgba(5,9,17,0.95))',
        boxShadow: '0 30px 80px rgba(0,0,0,0.48), inset 0 0 0 1px rgba(255,255,255,0.03)',
        backdropFilter: 'blur(18px)',
      };

  const mapStyle: CSSProperties = {
    position: 'relative',
    aspectRatio: '1 / 1',
    overflow: 'hidden',
    border: `1px solid ${mini ? 'rgba(124,246,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
    background: [
      'radial-gradient(circle at 50% 50%, rgba(255,107,53,0.12), transparent 24%)',
      'radial-gradient(circle at 25% 22%, rgba(0,229,255,0.12), transparent 20%)',
      'radial-gradient(circle at 76% 68%, rgba(118,255,3,0.1), transparent 22%)',
      'linear-gradient(180deg, rgba(15,28,38,0.96), rgba(7,11,18,0.98))',
    ].join(', '),
  };

  return (
    <div style={shellStyle}>
      <div style={panelStyle}>
        <div style={{
          gridColumn: mini ? undefined : '1 / -1',
          display: 'flex',
          alignItems: mini ? 'center' : 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '10px',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: mini ? '7px' : '10px',
              letterSpacing: '0.16em',
              color: headerAccent,
              marginBottom: mini ? '3px' : '5px',
            }}>
              {mini ? 'TACTICAL UPLINK' : 'MATCH TACTICAL MAP'}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: mini ? '10px' : '14px',
              letterSpacing: '0.08em',
              color: '#e8edf5',
            }}>
              {snapshot.stats.players} PLAYERS  /  {snapshot.stats.vehicles} VEHICLES
            </div>
          </div>
          <div style={{
            display: 'flex',
            gap: mini ? '8px' : '12px',
            alignItems: 'center',
            color: '#7f8ba0',
            fontFamily: 'var(--font-pixel)',
            fontSize: mini ? '6px' : '7px',
            letterSpacing: '0.12em',
            textAlign: 'right',
          }}>
            <span>{mini ? `[M] FULL` : '[M] CLOSE'}</span>
            {!mini && <span>NORTH-UP LIVE FEED</span>}
          </div>
        </div>

        <div style={mini ? undefined : { position: 'relative' }}>
          <div style={mapStyle}>
            <div style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: [
                'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
              ].join(', '),
              backgroundSize: mini ? '36px 36px' : '64px 64px',
              opacity: 0.26,
            }} />
            <div style={{
              position: 'absolute',
              inset: '8%',
              border: '1px solid rgba(255,255,255,0.08)',
              opacity: 0.35,
            }} />
            <div style={{
              position: 'absolute',
              inset: '32%',
              border: '1px solid rgba(255,209,102,0.16)',
              borderRadius: '999px',
            }} />

            {[
              { label: 'N', x: 50, y: 5 },
              { label: 'S', x: 50, y: 95 },
              { label: 'W', x: 5, y: 50 },
              { label: 'E', x: 95, y: 50 },
            ].map((cardinal) => (
              <div
                key={cardinal.label}
                style={{
                  ...markerTransform(cardinal.x, cardinal.y),
                  fontFamily: 'var(--font-pixel)',
                  fontSize: mini ? '6px' : '8px',
                  letterSpacing: '0.12em',
                  color: cardinal.label === 'N' ? '#ff8f5a' : '#697689',
                  opacity: 0.9,
                }}
              >
                {cardinal.label}
              </div>
            ))}

            {snapshot.markers.map((marker) => {
              const x = toPercent(marker.x, snapshot.width);
              const y = toPercent(marker.z, snapshot.height);
              const zone = marker.kind === 'zone';
              return (
                <div key={marker.id} style={markerTransform(x, y)}>
                  <div style={{
                    width: zone ? (mini ? '18px' : '24px') : (mini ? '10px' : '12px'),
                    height: zone ? (mini ? '18px' : '24px') : (mini ? '10px' : '12px'),
                    transform: zone ? 'rotate(45deg)' : 'rotate(45deg)',
                    border: `1px solid ${marker.color}`,
                    background: zone ? 'rgba(255,209,102,0.08)' : `${marker.color}22`,
                    boxShadow: `0 0 18px ${marker.color}33`,
                  }} />
                  {(!mini || zone) && (
                    <div style={{
                      marginTop: '6px',
                      transform: 'translateX(-50%)',
                      position: 'absolute',
                      left: '50%',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: mini ? '5px' : '6px',
                      letterSpacing: '0.12em',
                      color: marker.color,
                      textShadow: '0 1px 0 rgba(0,0,0,0.8)',
                    }}>
                      {marker.label.toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}

            {snapshot.vehicles.map((vehicle) => {
              const x = toPercent(vehicle.x, snapshot.width);
              const y = toPercent(vehicle.z, snapshot.height);
              const markerSize = mini ? 14 : 20;
              return (
                <div key={vehicle.id} style={markerTransform(x, y)}>
                  <div style={{
                    width: `${markerSize}px`,
                    height: `${markerSize}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${vehicle.color}`,
                    background: vehicle.occupied ? `${vehicle.color}2d` : 'rgba(10,14,22,0.86)',
                    color: vehicle.color,
                    fontFamily: 'var(--font-pixel)',
                    fontSize: vehicle.shortLabel.length > 1 ? (mini ? '5px' : '7px') : (mini ? '7px' : '9px'),
                    letterSpacing: '0.08em',
                    boxShadow: `0 0 20px ${vehicle.color}26`,
                    transform: `rotate(${vehicle.yaw}deg)`,
                    borderRadius: vehicle.shortLabel === 'J' ? '40% 40% 6px 6px' : '4px',
                  }}>
                    <span style={{ transform: `rotate(${-vehicle.yaw}deg)` }}>{vehicle.shortLabel}</span>
                  </div>
                  {!mini && (
                    <div style={{
                      marginTop: '8px',
                      transform: 'translateX(-50%)',
                      position: 'absolute',
                      left: '50%',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '6px',
                      letterSpacing: '0.08em',
                      color: vehicle.color,
                    }}>
                      {vehicle.label.toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}

            {snapshot.players.map((player) => {
              const x = toPercent(player.x, snapshot.width);
              const y = toPercent(player.z, snapshot.height);
              const playerSize = player.isSelf ? (mini ? 12 : 14) : (mini ? 8 : 10);
              return (
                <div key={player.id} style={markerTransform(x, y)}>
                  {player.isSelf && (
                    <>
                      <div style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: mini ? '22px' : '30px',
                        height: mini ? '22px' : '30px',
                        transform: 'translate(-50%, -50%)',
                        border: '1px solid rgba(124,246,255,0.3)',
                        borderRadius: '999px',
                        boxShadow: '0 0 20px rgba(124,246,255,0.26)',
                      }} />
                      <div style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: 0,
                        height: 0,
                        borderLeft: mini ? '5px solid transparent' : '7px solid transparent',
                        borderRight: mini ? '5px solid transparent' : '7px solid transparent',
                        borderBottom: mini ? '12px solid #7cf6ff' : '16px solid #7cf6ff',
                        transform: `translate(-50%, -115%) rotate(${heading}deg)`,
                        filter: 'drop-shadow(0 0 10px rgba(124,246,255,0.45))',
                      }} />
                    </>
                  )}
                  <div style={{
                    width: `${playerSize}px`,
                    height: `${playerSize}px`,
                    borderRadius: player.isSelf ? '4px' : '999px',
                    border: `1px solid ${player.isSelf ? '#7cf6ff' : player.color}`,
                    background: player.alive ? (player.isSelf ? 'rgba(124,246,255,0.9)' : player.color) : 'rgba(101,112,128,0.45)',
                    boxShadow: player.isSelf ? '0 0 14px rgba(124,246,255,0.4)' : `0 0 10px ${player.color}33`,
                    opacity: player.alive ? 1 : 0.45,
                  }} />
                  {player.isMounted && !player.isSelf && (
                    <div style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: mini ? '14px' : '18px',
                      height: mini ? '14px' : '18px',
                      transform: 'translate(-50%, -50%)',
                      border: '1px dashed rgba(255,255,255,0.24)',
                      borderRadius: '999px',
                    }} />
                  )}
                  {labelPlayers && (
                    <div style={{
                      position: 'absolute',
                      left: '50%',
                      top: mini ? '12px' : '14px',
                      transform: 'translateX(-50%)',
                      maxWidth: mini ? '66px' : '92px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: mini ? '5px' : '6px',
                      letterSpacing: '0.08em',
                      color: player.isSelf ? '#7cf6ff' : '#d6deea',
                      textShadow: '0 1px 0 rgba(0,0,0,0.85)',
                    }}>
                      {player.isSelf ? 'YOU' : player.name.toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {!mini && (
          <div style={{
            display: 'grid',
            gap: '12px',
            alignContent: 'start',
          }}>
            <div style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.02)',
              padding: '12px',
            }}>
              <div style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '7px',
                letterSpacing: '0.14em',
                color: '#ff8f5a',
                marginBottom: '10px',
              }}>
                LIVE COUNTS
              </div>
              {[
                ['Helicopters', snapshot.stats.helicopters, '#7cf6ff'],
                ['Jets', snapshot.stats.jets, '#ff8f5a'],
                ['Anti-Air', snapshot.stats.antiAir, '#ffe66d'],
                ['Pickups', snapshot.stats.pickups, '#76ff03'],
              ].map(([label, value, color]) => (
                <div
                  key={String(label)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '6px',
                    letterSpacing: '0.08em',
                    color: '#93a0b5',
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color: String(color),
                  }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.02)',
              padding: '12px',
            }}>
              <div style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '7px',
                letterSpacing: '0.14em',
                color: '#7cf6ff',
                marginBottom: '10px',
              }}>
                LEGEND
              </div>
              {[
                ['You', '#7cf6ff'],
                ['Players', '#d6deea'],
                ['Vehicles', '#ff8f5a'],
                ['Support markers', '#76ff03'],
              ].map(([label, color]) => (
                <div
                  key={String(label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '8px',
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '6px',
                    letterSpacing: '0.08em',
                    color: '#aeb8c8',
                  }}
                >
                  <div style={{
                    width: '10px',
                    height: '10px',
                    background: String(color),
                    borderRadius: label === 'Players' ? '999px' : '3px',
                    boxShadow: `0 0 12px ${String(color)}33`,
                  }} />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <div style={{
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.02)',
              padding: '12px',
              fontFamily: 'var(--font-pixel)',
              fontSize: '6px',
              letterSpacing: '0.1em',
              color: '#7f8ba0',
              lineHeight: '1.9',
            }}>
              <div>LIVE PLAYER AND VEHICLE TRACKING</div>
              <div>MINIMAP SIDE IS CONFIGURABLE IN SETTINGS</div>
              <div>FULL MAP FOLLOWS THE CURRENT MATCH IN REAL TIME</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TacticalMinimap({ snapshot, heading, side }: TacticalMinimapProps) {
  return <MapFrame variant="mini" snapshot={snapshot} heading={heading} side={side} />;
}

export function TacticalMapOverlay({ open, snapshot, heading }: TacticalMapOverlayProps) {
  if (!open) return null;
  return <MapFrame variant="full" snapshot={snapshot} heading={heading} />;
}
