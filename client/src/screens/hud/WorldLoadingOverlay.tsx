export interface WorldLoadingOverlayProps {
  loadingPercent: number;
}

export function WorldLoadingOverlay({ loadingPercent }: WorldLoadingOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{
        background: 'radial-gradient(circle at center, rgba(10,16,24,0.86), rgba(2,4,8,0.985))',
        backdropFilter: 'blur(6px)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ width: 'min(460px, calc(100vw - 40px))' }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '20px',
          letterSpacing: '0.08em',
          color: 'var(--c-text)',
          textAlign: 'center',
          textShadow: '0 0 14px rgba(255,255,255,0.2)',
          marginBottom: '10px',
        }}>
          STABILIZING COMBAT ZONE
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--c-muted)',
          textAlign: 'center',
          marginBottom: '14px',
        }}>
          Streaming nearby terrain first
        </div>
        <div style={{
          height: '12px',
          border: '1px solid rgba(255,255,255,0.28)',
          background: 'rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 0 8px rgba(0,0,0,0.45)',
        }}>
          <div style={{
            width: `${loadingPercent}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #2f90ff, #60d6ff)',
            boxShadow: '0 0 12px rgba(96,214,255,0.45)',
            transition: 'width 160ms linear',
          }} />
        </div>
        <div style={{
          marginTop: '10px',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          letterSpacing: '0.1em',
          color: 'var(--c-blue)',
          textAlign: 'center',
        }}>
          {loadingPercent}%
        </div>
        <div style={{
          marginTop: '8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          letterSpacing: '0.12em',
          color: 'var(--c-muted)',
          textAlign: 'center',
          textTransform: 'uppercase',
        }}>
          Movement locked until nearby chunks are ready
        </div>
      </div>
    </div>
  );
}
