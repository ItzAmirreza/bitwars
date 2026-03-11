import { useState } from 'react';
import { useGameStore } from '../store';

export function LoginScreen() {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const { connection, setUsername, setScreen, setError } = useGameStore();
  const error = useGameStore((s) => s.error);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = input.trim();
    if (!name || name.length > 20 || !connection) return;

    connection.reducers.setUsername({ username: name });
    setUsername(name);
    setScreen('lobby');
    setError(null);
  };

  return (
    <div className="scanlines grid-bg flex items-center justify-center h-full relative overflow-hidden">
      {/* Ambient glow orb */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,65,0.06) 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Decorative corner lines */}
      <div className="absolute top-6 left-6 anim-fade-in" style={{ animationDelay: '0.8s' }}>
        <div style={{ width: '60px', height: '1px', background: 'var(--c-border-bright)' }} />
        <div style={{ width: '1px', height: '60px', background: 'var(--c-border-bright)' }} />
      </div>
      <div className="absolute bottom-6 right-6 anim-fade-in" style={{ animationDelay: '0.8s' }}>
        <div className="flex flex-col items-end">
          <div style={{ width: '60px', height: '1px', background: 'var(--c-border-bright)', marginBottom: '-1px' }} />
          <div className="flex justify-end" style={{ width: '60px' }}>
            <div style={{ width: '1px', height: '60px', background: 'var(--c-border-bright)' }} />
          </div>
        </div>
      </div>

      {/* Version tag */}
      <div
        className="absolute top-6 right-6 anim-fade-in"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--c-muted)',
          letterSpacing: '0.1em',
          animationDelay: '1s',
        }}
      >
        v0.1.0 // ALPHA
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <div className="anim-fade-up" style={{ animationDelay: '0.1s' }}>
          <h1
            className="glow-green"
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '36px',
              color: 'var(--c-green)',
              letterSpacing: '0.05em',
            }}
          >
            BITWARS
          </h1>
        </div>

        <div className="anim-fade-up" style={{ animationDelay: '0.2s' }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--c-muted)',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              marginTop: '8px',
            }}
          >
            voxel warfare // multiplayer sandbox
          </p>
        </div>

        {/* Divider */}
        <div className="anim-fade-in" style={{ animationDelay: '0.4s', width: '280px', margin: '32px 0' }}>
          <div className="hr-tactical" />
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-5">
          {/* Input field */}
          <div className="anim-fade-up" style={{ animationDelay: '0.4s' }}>
            <label
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: '8px',
              }}
            >
              {focused ? '> ' : ''}callsign designation
            </label>
            <div className="corner-brackets" style={{ padding: '2px' }}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="ENTER CALLSIGN..."
                maxLength={20}
                autoFocus
                className="input-tactical w-72 text-center"
                style={{ fontSize: '16px' }}
              />
            </div>
          </div>

          {/* Deploy button */}
          <div className="anim-fade-up" style={{ animationDelay: '0.5s' }}>
            <button type="submit" className="btn-primary w-72 glitch-hover">
              DEPLOY
            </button>
          </div>

          {/* Error */}
          {error && (
            <p
              className="glow-red anim-fade-up"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--c-red)',
              }}
            >
              ⚠ {error}
            </p>
          )}
        </form>

        {/* Bottom info */}
        <div
          className="anim-fade-in"
          style={{
            animationDelay: '0.7s',
            marginTop: '48px',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: 'var(--c-muted2)',
              letterSpacing: '0.15em',
              lineHeight: '1.8',
            }}
          >
            DESTROY EVERYTHING // 3 WEAPONS // REAL-TIME MULTIPLAYER
            <br />
            POWERED BY SPACETIMEDB
          </p>
        </div>
      </div>
    </div>
  );
}
