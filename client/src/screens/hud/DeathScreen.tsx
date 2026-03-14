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
        background: 'rgba(15,0,0,0.7)',
        animation: 'death-fade-in 0.5s ease-out',
      }}
    >
      <div className="text-center" style={{ animation: 'death-text-in 0.6s ease-out' }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '32px',
          color: 'var(--c-red)',
          textShadow: '0 0 30px rgba(255,0,51,0.8), 0 0 60px rgba(255,0,51,0.4)',
          letterSpacing: '0.15em',
          marginBottom: '16px',
        }}>
          YOU DIED
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--c-muted)',
          letterSpacing: '0.15em',
          marginBottom: '8px',
        }}>
          {respawnCountdown > 0 ? `RESPAWNING IN ${respawnCountdown}...` : 'RESPAWNING...'}
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--c-muted2)',
          letterSpacing: '0.1em',
        }}>
          K/D: {kills}/{deaths}
        </div>
      </div>
    </div>
  );
}
