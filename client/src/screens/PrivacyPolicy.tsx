import { useEffect } from 'react';
import { menuAudio } from '../menuAudio';

// 9x8 pixel-art Discord logo — two "ears", wide body, dot eyes
export function PixelDiscordIcon({ color = '#7c4dff', size = 1 }: { color?: string; size?: number }) {
  // Each rect is 1×1 on the grid, scaled by size
  const s = size;
  // Pixel grid (9 wide × 8 tall):
  //  Row 0:  .X.....X.   ears
  //  Row 1:  .X.....X.
  //  Row 2:  XXXXXXXXX   top of head
  //  Row 3:  XXXXXXXXX
  //  Row 4:  XX.XXX.XX   eyes
  //  Row 5:  XXXXXXXXX
  //  Row 6:  .XXXXXXX.   jaw narrowing
  //  Row 7:  ..X...X..   feet/bumps
  const pixels: [number, number][] = [
    // Row 0-1: ears
    [1,0],[1,1],  [7,0],[7,1],
    // Row 2-3: top
    [0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],
    [0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[7,3],[8,3],
    // Row 4: eyes (skip 2,4 and 6,4)
    [0,4],[1,4],[3,4],[4,4],[5,4],[7,4],[8,4],
    // Row 5: full
    [0,5],[1,5],[2,5],[3,5],[4,5],[5,5],[6,5],[7,5],[8,5],
    // Row 6: narrowed
    [1,6],[2,6],[3,6],[4,6],[5,6],[6,6],[7,6],
    // Row 7: bumps
    [2,7],[6,7],
  ];
  return (
    <svg width={9 * s} height={8 * s} viewBox={`0 0 ${9 * s} ${8 * s}`} fill="none">
      {pixels.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x * s} y={y * s} width={s} height={s} fill={color} />
      ))}
    </svg>
  );
}

export function PrivacyPolicy({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const sectionTitle: React.CSSProperties = {
    fontFamily: 'var(--font-pixel)',
    fontSize: '11px',
    color: '#00e5ff',
    letterSpacing: '0.1em',
    marginTop: '20px',
    marginBottom: '8px',
  };

  const paragraph: React.CSSProperties = {
    fontFamily: 'var(--font-pixel)',
    fontSize: '8px',
    color: '#a0a4b0',
    lineHeight: 2,
    marginBottom: '10px',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0e1018',
          border: '3px solid #2a2e3e',
          boxShadow: '6px 6px 0 #000',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '28px 32px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '16px',
            color: '#ff6b35',
            letterSpacing: '0.1em',
          }}>
            PRIVACY POLICY
          </h2>
          <button
            onClick={() => { menuAudio.playUIClick(); onClose(); }}
            onMouseEnter={() => menuAudio.playUIHover()}
            style={{
              background: 'none',
              border: '2px solid #2a2e3e',
              color: '#6b7080',
              fontFamily: 'var(--font-pixel)',
              fontSize: '10px',
              padding: '6px 10px',
              cursor: 'pointer',
            }}
          >
            ESC
          </button>
        </div>

        <div style={{ marginTop: '6px', marginBottom: '16px' }}>
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '7px', color: '#4a4e5e' }}>
            LAST UPDATED: APRIL 2026
          </span>
        </div>

        <p style={paragraph}>
          BitWars (&quot;the Game&quot;) respects your privacy. This policy explains what data we collect
          and how we use it.
        </p>

        <h3 style={sectionTitle}>DATA WE COLLECT</h3>
        <p style={paragraph}>
          &bull; <strong style={{ color: '#e8e8f0' }}>Username</strong> — The call sign you choose when joining. This is visible to other players.<br />
          &bull; <strong style={{ color: '#e8e8f0' }}>Gameplay data</strong> — Kills, deaths, scores, and other in-game stats for the duration of your session.<br />
          &bull; <strong style={{ color: '#e8e8f0' }}>Connection data</strong> — Your IP address and WebSocket connection metadata, used to maintain your game session.
        </p>

        <h3 style={sectionTitle}>HOW WE USE IT</h3>
        <p style={paragraph}>
          All data is used solely to operate the game. Usernames and stats are stored in the game
          database for the duration of the session. We do not sell, share, or use your data for
          advertising purposes.
        </p>

        <h3 style={sectionTitle}>DATA RETENTION</h3>
        <p style={paragraph}>
          Game session data (username, stats) is stored in SpacetimeDB and may persist between sessions.
          Connection metadata is not retained after disconnection.
        </p>

        <h3 style={sectionTitle}>THIRD PARTIES</h3>
        <p style={paragraph}>
          &bull; <strong style={{ color: '#e8e8f0' }}>SpacetimeDB</strong> — Hosts the game server and database. Subject to their own privacy policy.<br />
          &bull; <strong style={{ color: '#e8e8f0' }}>Cloudflare</strong> — Serves the game client. Subject to their own privacy policy.
        </p>

        <h3 style={sectionTitle}>COOKIES</h3>
        <p style={paragraph}>
          BitWars does not use cookies or third-party tracking. Game settings are stored locally
          in your browser&apos;s localStorage.
        </p>

        <h3 style={sectionTitle}>CONTACT</h3>
        <p style={paragraph}>
          Questions or concerns? Reach us on{' '}
          <a
            href="https://discord.gg/R9HEJBqJAX"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#7c4dff', textDecoration: 'underline' }}
          >
            Discord
          </a>.
        </p>
      </div>
    </div>
  );
}
