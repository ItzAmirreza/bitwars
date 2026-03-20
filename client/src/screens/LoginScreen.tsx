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
      if (particles.length > 35) return;
      const maxLife = 300 + Math.random() * 400;
      particles.push({
        x: Math.random() * canvas.width,
        y: canvas.height + 10,
        vx: (Math.random() - 0.5) * 0.2,
        vy: -(0.2 + Math.random() * 0.4),
        size: 1 + Math.random() * 1.5,
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
        p.opacity *= 0.2;

        if (p.life > p.maxLife) {
          particles.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * 0.08})`;
        ctx.fill();
      }

      if (Math.random() < 0.08) spawn();
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
      style={{ opacity: 0.6 }}
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
    <div
      className="flex items-center justify-center h-full relative overflow-hidden"
      style={{ background: 'var(--c-bg)' }}
    >
      <ParticleField />

      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '900px',
          height: '900px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,65,0.05) 0%, rgba(0,140,255,0.015) 40%, transparent 65%)',
          top: '45%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          animation: 'breath 6s ease-in-out infinite',
        }}
      />

      {/* Main content */}
      <div
        className="relative z-10 flex flex-col items-center"
        style={{
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.6s ease',
          maxWidth: '640px',
          width: '100%',
          padding: '0 24px',
        }}
      >
        {/* Title */}
        <div className="anim-fade-up" style={{ animationDelay: '0.1s' }}>
          <h1
            className="title-glow"
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: 'clamp(42px, 7.5vw, 76px)',
              color: 'var(--c-green)',
              letterSpacing: '0.14em',
              textAlign: 'center',
            }}
          >
            BITWARS
          </h1>
        </div>

        <div className="anim-fade-up" style={{ animationDelay: '0.2s' }}>
          <p
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'clamp(14px, 1.8vw, 18px)',
              color: '#8888a0',
              letterSpacing: '0.3em',
              textTransform: 'uppercase',
              marginTop: '16px',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            VOXEL FPS &nbsp;&bull;&nbsp; MULTIPLAYER
          </p>
        </div>

        {/* Divider */}
        <div
          className="anim-fade-in"
          style={{
            animationDelay: '0.35s',
            width: '100%',
            maxWidth: '400px',
            margin: '40px auto 36px',
          }}
        >
          <div
            style={{
              height: '2px',
              background: 'linear-gradient(90deg, transparent, var(--c-green-dim) 30%, var(--c-green-dim) 70%, transparent)',
              opacity: 0.35,
            }}
          />
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="flex flex-col items-center w-full" style={{ gap: '28px' }}>
          {/* Name input */}
          <div className="anim-fade-up w-full" style={{ animationDelay: '0.35s', maxWidth: '400px' }}>
            <label
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '14px',
                fontWeight: 700,
                color: '#eaeaf0',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: '12px',
              }}
            >
              YOUR NAME
            </label>
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
              placeholder="Enter name..."
              maxLength={20}
              autoFocus
              style={{
                width: '100%',
                background: 'var(--c-surface)',
                border: `2px solid ${focused ? 'var(--c-green)' : 'var(--c-border-bright)'}`,
                color: '#eaeaf0',
                fontFamily: 'var(--font-ui)',
                fontWeight: 600,
                padding: '16px 20px',
                fontSize: '20px',
                letterSpacing: '0.05em',
                outline: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxShadow: focused ? '0 0 20px rgba(0,255,65,0.12)' : 'none',
              }}
            />
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: '#555570',
                textAlign: 'right',
                marginTop: '8px',
              }}
            >
              {input.length}/20
            </div>
          </div>

          {/* Character presets */}
          <div className="anim-fade-up w-full" style={{ animationDelay: '0.42s' }}>
            <label
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '14px',
                fontWeight: 700,
                color: '#eaeaf0',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: '14px',
                textAlign: 'center',
              }}
            >
              CHOOSE YOUR LOOK
            </label>
            <div className="flex flex-wrap justify-center" style={{ gap: '10px' }}>
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
                    style={{
                      border: `2px solid ${selected ? 'var(--c-green)' : 'var(--c-border-bright)'}`,
                      background: selected ? 'rgba(0,255,65,0.1)' : 'var(--c-surface)',
                      color: selected ? 'var(--c-green)' : '#eaeaf0',
                      minWidth: '110px',
                      padding: '16px 14px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: selected ? '0 0 20px rgba(0,255,65,0.15)' : 'none',
                    }}
                  >
                    {/* Color preview blocks */}
                    <div className="flex justify-center mb-3" style={{ gap: '3px' }}>
                      <span style={{ width: '14px', height: '20px', borderRadius: '2px', background: colorHex(preset.headColor), display: 'inline-block' }} />
                      <span style={{ width: '22px', height: '20px', borderRadius: '2px', background: colorHex(preset.bodyColor), display: 'inline-block' }} />
                      <span style={{ width: '16px', height: '20px', borderRadius: '2px', background: colorHex(preset.gunColor), display: 'inline-block' }} />
                    </div>
                    {/* Visor color indicator */}
                    <div
                      style={{
                        width: '30px',
                        height: '4px',
                        background: colorHex(preset.visorColor),
                        margin: '0 auto 10px',
                        borderRadius: '2px',
                        boxShadow: `0 0 8px ${colorHex(preset.visorColor)}66`,
                      }}
                    />
                    <div
                      style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '13px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        marginBottom: '4px',
                      }}
                    >
                      {preset.name}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: selected ? 'var(--c-green-dim)' : '#8888a0',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {preset.role}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Play button */}
          <div className="anim-fade-up" style={{ animationDelay: '0.5s', width: '100%', maxWidth: '400px' }}>
            <button
              type="submit"
              disabled={submitting}
              onMouseEnter={() => menuAudio.playUIHover()}
              style={{
                width: '100%',
                background: submitting ? 'var(--c-green-dim)' : 'var(--c-green)',
                border: 'none',
                color: '#000',
                fontFamily: 'var(--font-ui)',
                fontWeight: 700,
                fontSize: '22px',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                padding: '20px 40px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 0 30px rgba(0,255,65,0.2)',
              }}
              onMouseOver={(e) => {
                if (!submitting) {
                  e.currentTarget.style.boxShadow = '0 0 40px rgba(0,255,65,0.4)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.boxShadow = '0 0 30px rgba(0,255,65,0.2)';
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {submitting ? 'CONNECTING...' : 'PLAY'}
            </button>
          </div>

          {/* Error */}
          {error && (
            <p
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--c-red)',
                padding: '12px 20px',
                background: 'rgba(255, 0, 51, 0.08)',
                border: '1px solid rgba(255, 0, 51, 0.25)',
                textAlign: 'center',
                width: '100%',
                maxWidth: '400px',
              }}
            >
              {error}
            </p>
          )}
        </form>

        {/* Feature tags */}
        <div
          className="anim-fade-in flex flex-wrap justify-center mt-10"
          style={{ animationDelay: '0.65s', gap: '12px' }}
        >
          {['DESTROY EVERYTHING', '5 WEAPONS', 'REAL-TIME PVP'].map((text, i) => (
            <div
              key={text}
              className="anim-fade-up"
              style={{
                animationDelay: `${0.65 + i * 0.08}s`,
                fontFamily: 'var(--font-ui)',
                fontSize: '13px',
                fontWeight: 600,
                color: '#8888a0',
                letterSpacing: '0.12em',
                padding: '8px 20px',
                border: '1px solid var(--c-border-bright)',
                textTransform: 'uppercase',
              }}
            >
              {text}
            </div>
          ))}
        </div>

        {/* Version */}
        <div className="anim-fade-in" style={{ animationDelay: '0.9s', marginTop: '28px' }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: '#555570',
              letterSpacing: '0.12em',
            }}
          >
            v0.1.0 ALPHA
          </p>
        </div>
      </div>
    </div>
  );
}
