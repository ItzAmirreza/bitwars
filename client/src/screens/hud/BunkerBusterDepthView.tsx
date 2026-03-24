import { useMemo } from 'react';

// Block type color lookup (mirrors VoxelWorld BLOCK_COLORS)
const BLOCK_COLORS: Record<number, string> = {
  0:  'rgba(0,0,0,0.1)',      // Air
  1:  '#7a7a78',               // Concrete
  2:  '#5a5a58',               // DarkConcrete
  3:  '#2a2a2e',               // Asphalt
  4:  '#8b4513',               // Rebar
  5:  '#6b3a2a',               // Brick
  6:  '#4a4e52',               // Metal
  7:  '#6a6258',               // Rubble
  8:  '#5a4e3a',               // Dirt
  9:  '#9a8e72',               // Sand
  10: '#4a7a3a',               // Grass
  11: '#6b4423',               // Wood
  12: '#6a6a6a',               // Stone
  13: '#d8d8e0',               // Snow
  14: '#ffcf78',               // Lantern
  15: '#1a1a2e',               // Bedrock
};

interface Props {
  depthData: {
    blockTypes: number[];
    bombY: number;
    columnTopY: number;
    columnBottomY: number;
  };
}

export function BunkerBusterDepthView({ depthData }: Props) {
  const { blockTypes, bombY, columnTopY } = depthData;
  const bombIndex = Math.max(0, Math.min(blockTypes.length - 1, columnTopY - Math.floor(bombY)));

  const rows = useMemo(() => blockTypes.map((bt, i) => ({
    color: BLOCK_COLORS[bt] ?? 'rgba(0,0,0,0.1)',
    isBomb: i === bombIndex,
    isAir: bt === 0,
  })), [blockTypes, bombIndex]);

  const rowHeight = Math.max(3, Math.min(6, Math.floor(200 / blockTypes.length)));
  const columnHeight = rowHeight * blockTypes.length;

  return (
    <div style={{
      position: 'fixed',
      right: 'calc(50% - 120px)',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '28px',
      height: `${columnHeight + 40}px`,
      maxHeight: '260px',
      background: 'rgba(0,8,20,0.85)',
      border: '1px solid #00ffcc',
      boxShadow: '0 0 8px rgba(0,255,204,0.25), inset 0 0 6px rgba(0,255,204,0.08)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      pointerEvents: 'none',
      zIndex: 15,
      overflow: 'hidden',
      transition: 'opacity 0.2s ease',
    }}>
      {/* Header */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '7px',
        letterSpacing: '0.2em',
        color: '#00ffcc',
        textTransform: 'uppercase',
        padding: '3px 0 2px',
        textAlign: 'center',
        width: '100%',
        borderBottom: '1px solid rgba(0,255,204,0.2)',
      }}>
        DEPTH
      </div>

      {/* Block column with scanline overlay */}
      <div style={{
        flex: 1,
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Scanline overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,255,204,0.04) 2px, rgba(0,255,204,0.04) 3px)',
          pointerEvents: 'none',
          zIndex: 1,
        }} />

        {/* Block rows */}
        <div style={{ position: 'relative', width: '100%' }}>
          {rows.map((row, i) => (
            <div key={i} style={{
              width: '100%',
              height: `${rowHeight}px`,
              background: row.isAir ? 'rgba(0,4,12,0.5)' : row.color,
              position: 'relative',
            }}>
              {row.isBomb && (
                <div style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  height: '3px',
                  background: '#ff4400',
                  boxShadow: '0 0 6px #ff4400, 0 0 12px rgba(255,68,0,0.5)',
                  zIndex: 2,
                }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom hint */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '6px',
        letterSpacing: '0.12em',
        color: 'rgba(255,255,255,0.3)',
        textAlign: 'center',
        padding: '2px 0 3px',
        width: '100%',
        borderTop: '1px solid rgba(0,255,204,0.15)',
        lineHeight: '1.4',
      }}>
        RMB<br />DET
      </div>
    </div>
  );
}
