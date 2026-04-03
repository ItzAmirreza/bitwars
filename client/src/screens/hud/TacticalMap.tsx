import type { CSSProperties } from 'react';
import type { TacticalMapSnapshot } from '../hooks/useTacticalMap';

/* ── Constants ── */

/** Minimap shows a 200×200 block area around the player */
const MINI_VIEW_RADIUS = 100;
/** Size of the minimap element in px */
const MINI_SIZE = 160;

/* ── Props ── */

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

/* ── Coordinate helpers ── */

/** Map world coords to percentage position within the full map */
function toPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** Map world coords to pixel position within the minimap, centered on player */
function toMiniPx(
  worldVal: number,
  selfVal: number,
  sizePx: number,
): number {
  const delta = worldVal - selfVal;
  const ratio = delta / MINI_VIEW_RADIUS;
  return sizePx * 0.5 + ratio * (sizePx * 0.5);
}

/** Is a world coordinate within the minimap's visible area? */
function inMiniRange(worldX: number, worldZ: number, selfX: number, selfZ: number): boolean {
  return (
    Math.abs(worldX - selfX) <= MINI_VIEW_RADIUS &&
    Math.abs(worldZ - selfZ) <= MINI_VIEW_RADIUS
  );
}

/* ── Shared SVG arrow for direction indicator ── */

function DirectionArrow({ size, color }: { size: number; color: string }) {
  const half = size / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: 'block' }}
    >
      <polygon
        points={`${half},0 ${size},${size} ${half},${size * 0.65} 0,${size}`}
        fill={color}
      />
    </svg>
  );
}

/* ── Player marker ── */

function PlayerDot({
  isSelf,
  alive,
  color,
  heading,
  name,
  sizePx,
  showLabel,
}: {
  isSelf: boolean;
  alive: boolean;
  color: string;
  heading: number;
  name: string;
  sizePx: number;
  showLabel: boolean;
}) {
  const dotSize = isSelf ? sizePx : sizePx * 0.7;
  const arrowSize = isSelf ? sizePx * 1.4 : sizePx;

  return (
    <div style={{ position: 'relative', width: 0, height: 0 }}>
      {/* Direction arrow */}
      {alive && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) rotate(${heading}deg)`,
            width: `${arrowSize}px`,
            height: `${arrowSize}px`,
            opacity: isSelf ? 1 : 0.7,
          }}
        >
          <DirectionArrow size={arrowSize} color={isSelf ? '#00e5ff' : color} />
        </div>
      )}

      {/* Center dot */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${dotSize}px`,
          height: `${dotSize}px`,
          transform: 'translate(-50%, -50%)',
          background: alive
            ? isSelf
              ? '#00e5ff'
              : color
            : '#4a4e5e',
          border: `2px solid ${alive ? (isSelf ? '#fff' : color) : '#4a4e5e'}`,
          opacity: alive ? 1 : 0.5,
          boxShadow: isSelf ? '2px 2px 0 rgba(0,0,0,0.4)' : 'none',
        }}
      />

      {/* Name label */}
      {showLabel && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: `${dotSize * 0.5 + 4}px`,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-pixel)',
            fontSize: '5px',
            letterSpacing: '0.08em',
            color: isSelf ? '#00e5ff' : '#e8e8f0',
            textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
          }}
        >
          {isSelf ? 'YOU' : name.toUpperCase()}
        </div>
      )}
    </div>
  );
}

function SelfMinimapMarker() {
  return (
    <div style={{ position: 'relative', width: 0, height: 0 }}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '18px',
          height: '18px',
          transform: 'translate(-50%, -50%)',
          border: '2px solid #00e5ff',
          background: 'rgba(0,229,255,0.14)',
          boxShadow: '2px 2px 0 rgba(0,0,0,0.4)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '4px',
          height: '4px',
          transform: 'translate(-50%, -50%)',
          background: '#ffffff',
        }}
      />
    </div>
  );
}

/* ── Vehicle marker ── */

function VehicleDot({
  shortLabel,
  color,
  occupied,
  yaw,
  sizePx,
  showLabel,
  label,
}: {
  shortLabel: string;
  color: string;
  occupied: boolean;
  yaw: number;
  sizePx: number;
  showLabel: boolean;
  label: string;
}) {
  return (
    <div style={{ position: 'relative', width: 0, height: 0 }}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: `${sizePx}px`,
          height: `${sizePx}px`,
          transform: `translate(-50%, -50%) rotate(${yaw}deg)`,
          border: `2px solid ${color}`,
          background: occupied ? `${color}44` : 'rgba(10,12,20,0.9)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            transform: `rotate(${-yaw}deg)`,
            fontFamily: 'var(--font-pixel)',
            fontSize: shortLabel.length > 1 ? '5px' : '6px',
            letterSpacing: '0.06em',
            color,
          }}
        >
          {shortLabel}
        </span>
      </div>
      {showLabel && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: `${sizePx * 0.5 + 4}px`,
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-pixel)',
            fontSize: '5px',
            letterSpacing: '0.08em',
            color,
            textShadow: '1px 1px 0 rgba(0,0,0,0.8)',
          }}
        >
          {label.toUpperCase()}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MINIMAP — player-centered, smaller radius
   ═══════════════════════════════════════════════════════ */

export function TacticalMinimap({ snapshot, heading, side }: TacticalMinimapProps) {
  const { selfX, selfZ, players, vehicles } = snapshot;
  const normalizedHeading = ((heading % 360) + 360) % 360;

  const shellStyle: CSSProperties = {
    position: 'absolute',
    top: '76px',
    ...(side === 'left' ? { left: '18px' } : { right: '18px' }),
    zIndex: 12,
    pointerEvents: 'none',
  };

  return (
    <div style={shellStyle}>
      {/* Header label */}
      <div
        style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '6px',
          letterSpacing: '0.14em',
          color: '#00e5ff',
          marginBottom: '4px',
        }}
      >
        MAP
      </div>

      {/* Map frame */}
      <div
        style={{
          width: `${MINI_SIZE}px`,
          height: `${MINI_SIZE}px`,
          border: '2px solid #1a1e2e',
          background: 'linear-gradient(180deg, rgba(15,20,28,0.96), rgba(8,11,18,0.96))',
          boxShadow: '3px 3px 0 rgba(0,0,0,0.3)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(circle at center, rgba(0,229,255,0.08), transparent 62%)',
          }}
        />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `rotate(${-normalizedHeading}deg)`,
            transformOrigin: '50% 50%',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '-24px',
              backgroundImage: [
                'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
                'linear-gradient(135deg, rgba(0,229,255,0.07), rgba(255,107,53,0.04) 55%, transparent 55%)',
              ].join(', '),
              backgroundSize: `${MINI_SIZE / 4}px ${MINI_SIZE / 4}px, ${MINI_SIZE / 4}px ${MINI_SIZE / 4}px, ${MINI_SIZE}px ${MINI_SIZE}px`,
              opacity: 0.9,
            }}
          />

          {/* Vehicles */}
          {vehicles.map((v) => {
            if (!inMiniRange(v.x, v.z, selfX, selfZ)) return null;
            const px = toMiniPx(v.x, selfX, MINI_SIZE);
            const py = toMiniPx(v.z, selfZ, MINI_SIZE);
            return (
              <div key={v.id} style={{ position: 'absolute', left: `${px}px`, top: `${py}px` }}>
                <VehicleDot
                  shortLabel={v.shortLabel}
                  color={v.color}
                  occupied={v.occupied}
                  yaw={v.yaw}
                  sizePx={12}
                  showLabel={false}
                  label={v.label}
                />
              </div>
            );
          })}

          {/* Other players */}
          {players
            .filter((p) => !p.isSelf)
            .map((p) => {
              if (!inMiniRange(p.x, p.z, selfX, selfZ)) return null;
              const px = toMiniPx(p.x, selfX, MINI_SIZE);
              const py = toMiniPx(p.z, selfZ, MINI_SIZE);
              return (
                <div key={p.id} style={{ position: 'absolute', left: `${px}px`, top: `${py}px` }}>
                  <PlayerDot
                    isSelf={false}
                    alive={p.alive}
                    color={p.color}
                    heading={p.yaw}
                    name={p.name}
                    sizePx={6}
                    showLabel={false}
                  />
                </div>
              );
            })}

          {/* World-direction labels rotate with the map instead of the player icon */}
          {[
            { label: 'N', x: MINI_SIZE / 2, y: 8 },
            { label: 'S', x: MINI_SIZE / 2, y: MINI_SIZE - 8 },
            { label: 'W', x: 8, y: MINI_SIZE / 2 },
            { label: 'E', x: MINI_SIZE - 8, y: MINI_SIZE / 2 },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                position: 'absolute',
                left: `${c.x}px`,
                top: `${c.y}px`,
                transform: 'translate(-50%, -50%)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '5px',
                letterSpacing: '0.08em',
                color: c.label === 'N' ? '#ff6b35' : '#4a4e5e',
              }}
            >
              {c.label}
            </div>
          ))}
        </div>

        {/* Crosshair at center (player position) */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: '1px',
            background: 'rgba(0,229,255,0.16)',
            transform: 'translateX(-0.5px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: '1px',
            background: 'rgba(0,229,255,0.16)',
            transform: 'translateY(-0.5px)',
          }}
        />

        {/* Self — fixed at center while the minimap scene rotates */}
        <div style={{ position: 'absolute', left: `${MINI_SIZE / 2}px`, top: `${MINI_SIZE / 2}px` }}>
          <SelfMinimapMarker />
        </div>
      </div>

      {/* Footer hint */}
      <div
        style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '5px',
          letterSpacing: '0.1em',
          color: '#4a4e5e',
          marginTop: '3px',
        }}
      >
        [M] FULL MAP
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FULL MAP OVERLAY — shows entire world
   ═══════════════════════════════════════════════════════ */

export function TacticalMapOverlay({ open, snapshot, heading }: TacticalMapOverlayProps) {
  if (!open) return null;

  const { width, height, players, vehicles, stats } = snapshot;
  const mapSize = 'min(calc(100vh - 160px), calc(100vw - 340px))';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,12,20,0.75)',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${mapSize} 200px`,
          gap: '12px',
          padding: '18px',
          border: '3px solid #1a1e2e',
          background: 'rgba(12,16,24,0.95)',
          boxShadow: '6px 6px 0 rgba(0,0,0,0.4)',
        }}
      >
        {/* Header row spanning both columns */}
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '2px solid #1a1e2e',
            paddingBottom: '8px',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '9px',
                letterSpacing: '0.14em',
                color: '#ff6b35',
                textShadow: '2px 2px 0 #000',
              }}
            >
              TACTICAL MAP
            </div>
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '6px',
                letterSpacing: '0.1em',
                color: '#6b7080',
                marginTop: '3px',
              }}
            >
              {stats.players} PLAYERS / {stats.vehicles} VEHICLES
            </div>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '6px',
              letterSpacing: '0.1em',
              color: '#4a4e5e',
            }}
          >
            [M] or [ESC] CLOSE
          </div>
        </div>

        {/* Map area */}
        <div
          style={{
            position: 'relative',
            width: mapSize,
            height: mapSize,
            border: '2px solid #1a1e2e',
            background: 'rgba(10,12,20,0.95)',
            overflow: 'hidden',
          }}
        >
          {/* Grid */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: [
                'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
                'linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
              ].join(', '),
              backgroundSize: '48px 48px',
            }}
          />

          {/* Quadrant cross */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: '1px',
              background: 'rgba(255,255,255,0.06)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: '1px',
              background: 'rgba(255,255,255,0.06)',
            }}
          />

          {/* Cardinals */}
          {[
            { label: 'N', x: 50, y: 2 },
            { label: 'S', x: 50, y: 98 },
            { label: 'W', x: 2, y: 50 },
            { label: 'E', x: 98, y: 50 },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                position: 'absolute',
                left: `${c.x}%`,
                top: `${c.y}%`,
                transform: 'translate(-50%, -50%)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '7px',
                letterSpacing: '0.1em',
                color: c.label === 'N' ? '#ff6b35' : '#4a4e5e',
              }}
            >
              {c.label}
            </div>
          ))}

          {/* Vehicles */}
          {vehicles.map((v) => {
            const x = toPercent(v.x, width);
            const y = toPercent(v.z, height);
            return (
              <div
                key={v.id}
                style={{
                  position: 'absolute',
                  left: `${x}%`,
                  top: `${y}%`,
                }}
              >
                <VehicleDot
                  shortLabel={v.shortLabel}
                  color={v.color}
                  occupied={v.occupied}
                  yaw={v.yaw}
                  sizePx={18}
                  showLabel
                  label={v.label}
                />
              </div>
            );
          })}

          {/* Players */}
          {players.map((p) => {
            const x = toPercent(p.x, width);
            const y = toPercent(p.z, height);
            return (
              <div
                key={p.id}
                style={{
                  position: 'absolute',
                  left: `${x}%`,
                  top: `${y}%`,
                }}
              >
                <PlayerDot
                  isSelf={p.isSelf}
                  alive={p.alive}
                  color={p.color}
                  heading={p.isSelf ? heading : p.yaw}
                  name={p.name}
                  sizePx={p.isSelf ? 10 : 8}
                  showLabel={players.length <= 16}
                />
              </div>
            );
          })}
        </div>

        {/* Side panel — stats + legend */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Live counts */}
          <div
            style={{
              border: '2px solid #1a1e2e',
              background: 'rgba(10,12,20,0.9)',
              padding: '10px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '6px',
                letterSpacing: '0.14em',
                color: '#ff6b35',
                marginBottom: '8px',
              }}
            >
              LIVE COUNTS
            </div>
            {([
              ['HELICOPTERS', stats.helicopters, '#00e5ff'],
              ['JETS', stats.jets, '#ff6b35'],
              ['ANTI-AIR', stats.antiAir, '#ffd600'],
            ] as const).map(([label, value, color]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '5px',
                    letterSpacing: '0.08em',
                    color: '#6b7080',
                  }}
                >
                  {label}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color,
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div
            style={{
              border: '2px solid #1a1e2e',
              background: 'rgba(10,12,20,0.9)',
              padding: '10px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '6px',
                letterSpacing: '0.14em',
                color: '#00e5ff',
                marginBottom: '8px',
              }}
            >
              LEGEND
            </div>
            {([
              ['YOU', '#00e5ff'],
              ['PLAYERS', '#e8e8f0'],
              ['HELICOPTER', '#00e5ff'],
              ['JET', '#ff6b35'],
              ['ANTI-AIR', '#ffd600'],
            ] as const).map(([label, color]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginBottom: '5px',
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    background: color,
                    border: `2px solid ${color}`,
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '5px',
                    letterSpacing: '0.08em',
                    color: '#6b7080',
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Info */}
          <div
            style={{
              border: '2px solid #1a1e2e',
              background: 'rgba(10,12,20,0.9)',
              padding: '10px',
              fontFamily: 'var(--font-pixel)',
              fontSize: '5px',
              letterSpacing: '0.1em',
              color: '#4a4e5e',
              lineHeight: '2',
            }}
          >
            <div>LIVE TRACKING</div>
            <div>NORTH IS UP</div>
          </div>
        </div>
      </div>
    </div>
  );
}
