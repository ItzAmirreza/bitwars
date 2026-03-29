export interface DeathScreenProps {
  respawnCountdown: number;
  kills: number;
  deaths: number;
}

export function DeathScreen({ respawnCountdown, kills, deaths }: DeathScreenProps) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{
        background: 'rgba(15,0,0,0.75)',
        animation: 'death-fade-in 0.5s ease-out',
      }}
    >
      <div style={{ textAlign: 'center', animation: 'death-text-in 0.6s ease-out' }}>
        {/* Pixel skull */}
        <div style={{
          display: 'flex', justifyContent: 'center', marginBottom: '12px',
        }}>
          <svg width="40" height="40" viewBox="0 0 8 8" style={{ imageRendering: 'pixelated' }}>
            <rect x="1" y="0" width="6" height="1" fill="#ff2d78" />
            <rect x="0" y="1" width="8" height="1" fill="#ff2d78" />
            <rect x="0" y="2" width="2" height="1" fill="#ff2d78" />
            <rect x="3" y="2" width="2" height="1" fill="#ff2d78" />
            <rect x="6" y="2" width="2" height="1" fill="#ff2d78" />
            <rect x="2" y="2" width="1" height="1" fill="#0a0c14" />
            <rect x="5" y="2" width="1" height="1" fill="#0a0c14" />
            <rect x="0" y="3" width="8" height="1" fill="#ff2d78" />
            <rect x="0" y="4" width="2" height="1" fill="#ff2d78" />
            <rect x="3" y="4" width="2" height="1" fill="#ff2d78" />
            <rect x="6" y="4" width="2" height="1" fill="#ff2d78" />
            <rect x="1" y="5" width="6" height="1" fill="#ff2d78" />
            <rect x="2" y="6" width="4" height="1" fill="#ff2d78" />
            <rect x="2" y="7" width="1" height="1" fill="#ff2d78" />
            <rect x="5" y="7" width="1" height="1" fill="#ff2d78" />
          </svg>
        </div>

        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '28px',
          color: '#ff2d78',
          letterSpacing: '0.15em',
          marginBottom: '14px',
          textShadow: '3px 3px 0 #000',
        }}>
          YOU DIED
        </div>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '8px',
          color: '#6b7080',
          letterSpacing: '0.15em',
          marginBottom: '8px',
        }}>
          {respawnCountdown > 0 ? `RESPAWNING IN ${respawnCountdown}...` : 'RESPAWNING...'}
        </div>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '7px',
          color: '#4a4e5e',
          letterSpacing: '0.1em',
        }}>
          K/D: {kills}/{deaths}
        </div>
      </div>
    </div>
  );
}
