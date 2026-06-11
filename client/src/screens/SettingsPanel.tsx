import { useGameStore } from '../store';
import type { GameSettings } from '../store';
import { menuAudio } from '../menuAudio';

function Slider({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{
          fontFamily: 'var(--font-pixel)', fontSize: '7px',
          color: '#6b7080', letterSpacing: '0.1em',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#ff6b35',
        }}>
          {display}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#ff6b35', cursor: 'pointer' }}
      />
    </div>
  );
}

function Toggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px',
    }}>
      <span style={{
        fontFamily: 'var(--font-pixel)', fontSize: '7px',
        color: '#6b7080', letterSpacing: '0.1em',
      }}>
        {label}
      </span>
      <button
        onClick={() => { onChange(!value); menuAudio.playUIClick(); }}
        style={{
          fontFamily: 'var(--font-pixel)', fontSize: '7px',
          padding: '4px 12px',
          background: value ? 'rgba(118,255,3,0.15)' : 'rgba(255,255,255,0.05)',
          border: `2px solid ${value ? '#76ff03' : '#1a1e2e'}`,
          color: value ? '#76ff03' : '#6b7080',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          transition: 'all 0.1s',
        }}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function QualitySelect({ value, onChange }: {
  value: GameSettings['graphicsQuality'];
  onChange: (v: GameSettings['graphicsQuality']) => void;
}) {
  const options: GameSettings['graphicsQuality'][] = ['low', 'medium', 'high'];
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px',
    }}>
      <span style={{
        fontFamily: 'var(--font-pixel)', fontSize: '7px',
        color: '#6b7080', letterSpacing: '0.1em',
      }}>
        QUALITY
      </span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => { onChange(opt); menuAudio.playUIClick(); }}
            style={{
              fontFamily: 'var(--font-pixel)', fontSize: '6px',
              padding: '4px 10px',
              background: value === opt ? 'rgba(255,107,53,0.15)' : 'rgba(255,255,255,0.05)',
              border: `2px solid ${value === opt ? '#ff6b35' : '#1a1e2e'}`,
              color: value === opt ? '#ff6b35' : '#6b7080',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              transition: 'all 0.1s',
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MinimapSideSelect({ value, onChange }: {
  value: GameSettings['minimapSide'];
  onChange: (v: GameSettings['minimapSide']) => void;
}) {
  const options: GameSettings['minimapSide'][] = ['left', 'right'];
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px',
    }}>
      <span style={{
        fontFamily: 'var(--font-pixel)', fontSize: '7px',
        color: '#6b7080', letterSpacing: '0.1em',
      }}>
        MINIMAP SIDE
      </span>
      <div style={{ display: 'flex', gap: '4px' }}>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => { onChange(opt); menuAudio.playUIClick(); }}
            style={{
              fontFamily: 'var(--font-pixel)', fontSize: '6px',
              padding: '4px 10px',
              background: value === opt ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.05)',
              border: `2px solid ${value === opt ? '#00e5ff' : '#1a1e2e'}`,
              color: value === opt ? '#00e5ff' : '#6b7080',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              transition: 'all 0.1s',
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
  const { settings, setSettings, resetSettings, setShowSettings } = useGameStore();

  const sectionTitleStyle: React.CSSProperties = {
    fontFamily: 'var(--font-pixel)',
    fontSize: '8px',
    color: '#ff6b35',
    letterSpacing: '0.15em',
    marginBottom: '12px',
    paddingBottom: '6px',
    borderBottom: '2px solid #1a1e2e',
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,12,20,0.9)',
    }}>
      <div style={{
        width: 'min(420px, calc(100vw - 32px))',
        maxHeight: '80vh',
        overflowY: 'auto',
        background: 'rgba(12,16,24,0.98)',
        border: '3px solid #1a1e2e',
        padding: '24px',
        boxShadow: '6px 6px 0 rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px',
        }}>
          <span style={{
            fontFamily: 'var(--font-pixel)', fontSize: '12px',
            color: '#fff', letterSpacing: '0.1em',
            textShadow: '2px 2px 0 #ff6b35',
          }}>
            SETTINGS
          </span>
          <button
            onClick={() => { setShowSettings(false); menuAudio.playUIClick(); }}
            style={{
              fontFamily: 'var(--font-pixel)', fontSize: '10px',
              color: '#6b7080', background: 'none',
              border: '2px solid #1a1e2e', padding: '4px 10px',
              cursor: 'pointer', transition: 'all 0.1s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ff2d78'; e.currentTarget.style.color = '#ff2d78'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1a1e2e'; e.currentTarget.style.color = '#6b7080'; }}
          >
            X
          </button>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={sectionTitleStyle}>CONTROLS</div>
          <Slider label="SENSITIVITY" value={settings.sensitivity} min={0.0005} max={0.008} step={0.0005}
            display={settings.sensitivity.toFixed(4)} onChange={(v) => setSettings({ sensitivity: v })} />
          <Slider label="FIELD OF VIEW" value={settings.fov} min={60} max={120} step={1}
            display={`${settings.fov}`} onChange={(v) => setSettings({ fov: v })} />
          <Toggle label="SPRINT TOGGLE" value={settings.sprintToggle} onChange={(v) => setSettings({ sprintToggle: v })} />
          <MinimapSideSelect value={settings.minimapSide} onChange={(v) => setSettings({ minimapSide: v })} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={sectionTitleStyle}>GRAPHICS</div>
          <QualitySelect value={settings.graphicsQuality} onChange={(v) => setSettings({ graphicsQuality: v })} />
          <Toggle label="POST EFFECTS" value={settings.postFXEnabled} onChange={(v) => setSettings({ postFXEnabled: v })} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={sectionTitleStyle}>AUDIO</div>
          <Slider label="MASTER VOLUME" value={settings.masterVolume} min={0} max={1} step={0.05}
            display={`${Math.round(settings.masterVolume * 100)}%`} onChange={(v) => setSettings({ masterVolume: v })} />
        </div>

        <button
          onClick={() => { resetSettings(); menuAudio.playUINavigate(); }}
          style={{
            width: '100%', fontFamily: 'var(--font-pixel)', fontSize: '7px',
            color: '#6b7080', background: 'rgba(255,255,255,0.03)',
            border: '2px solid #1a1e2e', padding: '10px',
            cursor: 'pointer', letterSpacing: '0.12em', transition: 'all 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ffd600'; e.currentTarget.style.color = '#ffd600'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1a1e2e'; e.currentTarget.style.color = '#6b7080'; }}
        >
          RESET DEFAULTS
        </button>
      </div>
    </div>
  );
}
