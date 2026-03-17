import { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store';
import { menuAudio } from '../menuAudio';
import { CHARACTER_PRESETS, colorHex } from '../characterPresets';

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles: { x: number; y: number; vx: number; vy: number; size: number; opacity: number; life: number; maxLife: number }[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const spawn = () => {
      if (particles.length > 60) return;
      const maxLife = 200 + Math.random() * 300;
      particles.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 10,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -(0.3 + Math.random() * 0.7),
        size: 1 + Math.random() * 2,
        opacity: 0,
        life: 0,
        maxLife,
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        const progress = p.life / p.maxLife;
        p.opacity = progress < 0.1 ? progress * 10 : progress > 0.8 ? (1 - progress) * 5 : 1;
        p.opacity *= 0.4;

        if (p.life > p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 255, 65, ${p.opacity})`;
        ctx.fill();

        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 255, 65, ${p.opacity * 0.15})`;
        ctx.fill();
      }

      if (Math.random() < 0.15) spawn();
      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ opacity: 0.8 }}
    />
  );
}

export function LoginScreen() {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const {
    connection,
    setUsername,
    setScreen,
    setError,
    selectedCharacterPreset,
    setSelectedCharacterPreset,
  } = useGameStore();
  const error = useGameStore((s) => s.error);
  const settings = useGameStore((s) => s.settings);
  const selectedPreset = CHARACTER_PRESETS[selectedCharacterPreset] ?? CHARACTER_PRESETS[0];

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
    menuAudio.startMenuAmbience();
    setMounted(true);
    return () => {
      menuAudio.stopMenuAmbience();
    };
  }, []);

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = input.trim();
    if (!name || name.length > 20 || !connection || submitting) {
      if (!name) menuAudio.playUIError();
      return;
    }

    setSubmitting(true);
    setError(null);
    menuAudio.playUIDeploy();
    try {
      await connection.reducers.setUsername({
        username: name,
        characterPreset: selectedCharacterPreset,
      });
      setUsername(name);
      setScreen('lobby');
    } catch (error) {
      menuAudio.playUIError();
      setError(error instanceof Error ? error.message : 'Failed to set username');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="scanlines hex-bg flex items-center justify-center h-full relative overflow-hidden">
      {/* Particle field */}
      <ParticleField />

      {/* Ambient glow orbs */}
      <div
        className="absolute pointer-events-none anim-breath"
        style={{
          width: '800px',
          height: '800px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,65,0.08) 0%, rgba(0,229,255,0.02) 40%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,170,255,0.05) 0%, transparent 70%)',
          top: '20%',
          right: '10%',
          animation: 'breath 6s ease-in-out infinite 1s',
        }}
      />

      {/* Decorative corner lines */}
      <div className="absolute top-6 left-6 anim-fade-in" style={{ animationDelay: '0.8s' }}>
        <div style={{ width: '80px', height: '1px', background: 'linear-gradient(90deg, var(--c-green-dim), transparent)' }} />
        <div style={{ width: '1px', height: '80px', background: 'linear-gradient(180deg, var(--c-green-dim), transparent)' }} />
      </div>
      <div className="absolute bottom-6 right-6 anim-fade-in" style={{ animationDelay: '0.8s' }}>
        <div className="flex flex-col items-end">
          <div style={{ width: '80px', height: '1px', background: 'linear-gradient(270deg, var(--c-green-dim), transparent)', marginBottom: '-1px' }} />
          <div className="flex justify-end" style={{ width: '80px' }}>
            <div style={{ width: '1px', height: '80px', background: 'linear-gradient(0deg, var(--c-green-dim), transparent)' }} />
          </div>
        </div>
      </div>
      <div className="absolute top-6 right-6 anim-fade-in" style={{ animationDelay: '1s' }}>
        <div className="flex flex-col items-end">
          <div style={{ width: '80px', height: '1px', background: 'linear-gradient(270deg, var(--c-green-dim), transparent)' }} />
        </div>
      </div>
      <div className="absolute bottom-6 left-6 anim-fade-in" style={{ animationDelay: '1s' }}>
        <div style={{ width: '80px', height: '1px', background: 'linear-gradient(90deg, var(--c-green-dim), transparent)' }} />
      </div>

      {/* Version tag */}
      <div
        className="absolute top-6 right-6 anim-fade-in"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--c-muted)',
          letterSpacing: '0.1em',
          animationDelay: '1s',
          marginTop: '12px',
        }}
      >
        v0.1.0 // ALPHA
      </div>

      {/* Main content */}
      <div
        className="relative z-10 flex flex-col items-center"
        style={{
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.5s ease',
        }}
      >
        {/* Logo */}
        <div className="anim-fade-up" style={{ animationDelay: '0.1s' }}>
          <h1
            className="title-glow"
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: 'clamp(32px, 6vw, 56px)',
              color: 'var(--c-green)',
              letterSpacing: '0.12em',
            }}
          >
            BITWARS
          </h1>
        </div>

        <div className="anim-fade-up" style={{ animationDelay: '0.2s' }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(11px, 1.2vw, 14px)',
              color: 'var(--c-muted)',
              letterSpacing: '0.4em',
              textTransform: 'uppercase',
              marginTop: '12px',
              textAlign: 'center',
            }}
          >
            voxel warfare // multiplayer sandbox
          </p>
        </div>

        {/* Animated divider */}
        <div className="anim-fade-in" style={{ animationDelay: '0.4s', width: 'min(380px, 80vw)', margin: '36px 0' }}>
          <div className="gradient-line" />
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-6">
          {/* Input field */}
          <div className="anim-fade-up" style={{ animationDelay: '0.4s' }}>
            <label
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: focused ? 'var(--c-green-dim)' : 'var(--c-muted)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: '10px',
                transition: 'color 0.2s',
              }}
            >
              {focused ? '> ' : '  '}callsign designation
            </label>
            <div className="corner-brackets" style={{ padding: '2px' }}>
              <input
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  menuAudio.playUIType();
                }}
                onFocus={() => {
                  setFocused(true);
                  menuAudio.playUIClick();
                }}
                onBlur={() => setFocused(false)}
                placeholder="ENTER CALLSIGN..."
                maxLength={20}
                autoFocus
                className="input-tactical text-center"
                style={{ fontSize: '18px', letterSpacing: '0.1em', width: 'min(360px, 80vw)' }}
              />
            </div>
            {/* Character count */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--c-muted2)',
                textAlign: 'right',
                marginTop: '6px',
                letterSpacing: '0.05em',
              }}
            >
              {input.length}/20
            </div>
          </div>

          <div className="anim-fade-up" style={{ animationDelay: '0.48s', width: '100%', maxWidth: '600px' }}>
            <label
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--c-muted)',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: '14px',
                textAlign: 'center',
              }}
            >
              operator chassis // pick one
            </label>
            <div className="flex flex-wrap justify-center gap-3">
              {CHARACTER_PRESETS.map((preset) => {
                const selected = preset.id === selectedCharacterPreset;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      menuAudio.playUIClick();
                      setSelectedCharacterPreset(preset.id);
                    }}
                    className="anim-fade-up"
                    style={{
                      border: `2px solid ${selected ? 'var(--c-green)' : 'var(--c-border-bright)'}`,
                      background: selected ? 'rgba(0,255,65,0.12)' : 'rgba(10,14,20,0.72)',
                      color: selected ? 'var(--c-green)' : 'var(--c-text)',
                      minWidth: '108px',
                      padding: '14px 12px 10px',
                      transition: 'all 0.16s ease',
                      boxShadow: selected ? '0 0 16px rgba(0,255,65,0.2), inset 0 0 12px rgba(0,255,65,0.06)' : 'none',
                    }}
                  >
                    {/* Character silhouette preview */}
                    <div className="flex justify-center mb-3" style={{ gap: '3px' }}>
                      <span style={{ width: '12px', height: '18px', borderRadius: '2px', background: colorHex(preset.headColor), display: 'inline-block' }} />
                      <span style={{ width: '20px', height: '18px', borderRadius: '2px', background: colorHex(preset.bodyColor), display: 'inline-block' }} />
                      <span style={{ width: '14px', height: '18px', borderRadius: '2px', background: colorHex(preset.gunColor), display: 'inline-block' }} />
                    </div>
                    {/* Visor color indicator */}
                    <div style={{ width: '28px', height: '4px', background: colorHex(preset.visorColor), margin: '0 auto 8px', borderRadius: '2px', boxShadow: `0 0 8px ${colorHex(preset.visorColor)}44` }} />
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        letterSpacing: '0.08em',
                        color: selected ? 'var(--c-green)' : 'var(--c-text)',
                        textTransform: 'uppercase',
                        marginBottom: '3px',
                        fontWeight: selected ? 700 : 400,
                      }}
                    >
                      {preset.name}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: selected ? 'var(--c-green-dim)' : 'var(--c-muted)',
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {preset.role}
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: '14px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                letterSpacing: '0.1em',
                color: 'var(--c-muted)',
                textAlign: 'center',
              }}
            >
              ACTIVE: <span style={{ color: 'var(--c-green-dim)' }}>{selectedPreset.name.toUpperCase()}</span>
              {' // '}
              <span style={{ color: 'var(--c-muted2)' }}>{selectedPreset.role.toUpperCase()}</span>
            </div>
          </div>

          {/* Deploy button */}
          <div className="anim-fade-up" style={{ animationDelay: '0.5s' }}>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary glitch-hover"
              onMouseEnter={() => menuAudio.playUIHover()}
              style={{
                fontSize: '18px',
                padding: '18px 48px',
                width: 'min(360px, 80vw)',
                opacity: submitting ? 0.75 : 1,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'DEPLOYING...' : 'DEPLOY'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <p
              className="glow-red anim-fade-up"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: 'var(--c-red)',
                padding: '10px 18px',
                background: 'rgba(255, 0, 51, 0.08)',
                border: '1px solid rgba(255, 0, 51, 0.2)',
              }}
            >
              {error}
            </p>
          )}
        </form>

        {/* Feature badges */}
        <div
          className="anim-fade-in flex flex-wrap justify-center gap-4 mt-10"
          style={{ animationDelay: '0.7s' }}
        >
          {['DESTROY EVERYTHING', '5 WEAPONS', 'REAL-TIME PVP'].map((text, i) => (
            <div
              key={text}
              className="anim-fade-up"
              style={{
                animationDelay: `${0.7 + i * 0.1}s`,
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--c-muted)',
                letterSpacing: '0.1em',
                padding: '8px 18px',
                border: '1px solid var(--c-border-bright)',
                background: 'rgba(0, 255, 65, 0.03)',
              }}
            >
              {text}
            </div>
          ))}
        </div>

        {/* Bottom info */}
        <div
          className="anim-fade-in"
          style={{
            animationDelay: '1s',
            marginTop: '32px',
            textAlign: 'center',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--c-muted2)',
              letterSpacing: '0.15em',
            }}
          >
            POWERED BY SPACETIMEDB
          </p>
        </div>
      </div>
    </div>
  );
}
