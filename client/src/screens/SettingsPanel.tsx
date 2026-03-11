import { useGameStore } from '../store';
import type { GameSettings } from '../store';

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--c-muted)',
            letterSpacing: '0.1em',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--c-green)',
          }}
        >
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%',
          accentColor: 'var(--c-green)',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--c-muted)',
          letterSpacing: '0.1em',
        }}
      >
        {label}
      </span>
      <button
        onClick={() => onChange(!value)}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          padding: '2px 12px',
          background: value ? 'rgba(0,255,65,0.15)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${value ? 'var(--c-green)' : 'var(--c-border)'}`,
          color: value ? 'var(--c-green)' : 'var(--c-muted)',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          transition: 'all 0.15s',
        }}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function QualitySelect({
  value,
  onChange,
}: {
  value: GameSettings['graphicsQuality'];
  onChange: (v: GameSettings['graphicsQuality']) => void;
}) {
  const options: GameSettings['graphicsQuality'][] = ['low', 'medium', 'high'];
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: 'var(--c-muted)',
          letterSpacing: '0.1em',
        }}
      >
        QUALITY
      </span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              padding: '2px 10px',
              background:
                value === opt
                  ? 'rgba(0,255,65,0.15)'
                  : 'rgba(255,255,255,0.05)',
              border: `1px solid ${value === opt ? 'var(--c-green)' : 'var(--c-border)'}`,
              color: value === opt ? 'var(--c-green)' : 'var(--c-muted)',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              transition: 'all 0.15s',
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const { settings, setSettings, resetSettings, setShowSettings } =
    useGameStore();

  const sectionStyle = {
    marginBottom: '20px',
  };

  const sectionTitleStyle = {
    fontFamily: 'var(--font-mono)' as const,
    fontSize: '11px',
    color: 'var(--c-amber)',
    letterSpacing: '0.15em',
    marginBottom: '10px',
    paddingBottom: '4px',
    borderBottom: '1px solid var(--c-border)',
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(6,8,16,0.8)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: '380px',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'rgba(10,12,20,0.95)',
          border: '1px solid var(--c-border)',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '16px',
              color: 'var(--c-green)',
              letterSpacing: '0.1em',
              textShadow: '0 0 15px rgba(0,255,65,0.4)',
            }}
          >
            SETTINGS
          </span>
          <button
            onClick={() => setShowSettings(false)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '14px',
              color: 'var(--c-muted)',
              background: 'none',
              border: '1px solid var(--c-border)',
              padding: '2px 8px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--c-red)';
              e.currentTarget.style.color = 'var(--c-red)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--c-border)';
              e.currentTarget.style.color = 'var(--c-muted)';
            }}
          >
            X
          </button>
        </div>

        {/* CONTROLS */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>CONTROLS</div>
          <Slider
            label="SENSITIVITY"
            value={settings.sensitivity}
            min={0.0005}
            max={0.008}
            step={0.0005}
            display={settings.sensitivity.toFixed(4)}
            onChange={(v) => setSettings({ sensitivity: v })}
          />
          <Slider
            label="FIELD OF VIEW"
            value={settings.fov}
            min={60}
            max={120}
            step={1}
            display={`${settings.fov}`}
            onChange={(v) => setSettings({ fov: v })}
          />
          <Toggle
            label="SPRINT TOGGLE"
            value={settings.sprintToggle}
            onChange={(v) => setSettings({ sprintToggle: v })}
          />
        </div>

        {/* GRAPHICS */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>GRAPHICS</div>
          <QualitySelect
            value={settings.graphicsQuality}
            onChange={(v) => setSettings({ graphicsQuality: v })}
          />
          <Toggle
            label="SHADOWS"
            value={settings.shadowsEnabled}
            onChange={(v) => setSettings({ shadowsEnabled: v })}
          />
          <Toggle
            label="POST EFFECTS"
            value={settings.postFXEnabled}
            onChange={(v) => setSettings({ postFXEnabled: v })}
          />
        </div>

        {/* AUDIO */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>AUDIO</div>
          <Slider
            label="MASTER VOLUME"
            value={settings.masterVolume}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(settings.masterVolume * 100)}%`}
            onChange={(v) => setSettings({ masterVolume: v })}
          />
        </div>

        {/* Reset */}
        <button
          onClick={resetSettings}
          style={{
            width: '100%',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--c-muted)',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid var(--c-border)',
            padding: '8px',
            cursor: 'pointer',
            letterSpacing: '0.15em',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--c-amber)';
            e.currentTarget.style.color = 'var(--c-amber)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--c-border)';
            e.currentTarget.style.color = 'var(--c-muted)';
          }}
        >
          RESET DEFAULTS
        </button>
      </div>
    </div>
  );
}
