export interface TutorialOverlayProps {
  onDeploy: () => void;
}

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-pixel)',
        fontSize: '7px',
        color: '#0a0c14',
        background: '#e8e8f0',
        border: '2px solid #6b7080',
        padding: '2px 5px',
        minWidth: '18px',
        textAlign: 'center',
        lineHeight: '1.4',
        boxShadow: '2px 2px 0 rgba(0,0,0,0.4)',
      }}
    >
      {children}
    </span>
  );
}

function ControlRow({ keyLabel, action }: { keyLabel: React.ReactNode; action: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ minWidth: '56px', textAlign: 'right' }}>{keyLabel}</div>
      <span
        style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '6px',
          color: '#6b7080',
          letterSpacing: '0.08em',
        }}
      >
        {action}
      </span>
    </div>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '7px',
          color,
          letterSpacing: '0.12em',
          marginBottom: '8px',
          textShadow: `2px 2px 0 #000`,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {children}
      </div>
    </div>
  );
}

export function TutorialOverlay({ onDeploy }: TutorialOverlayProps) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer"
      onClick={onDeploy}
      style={{ background: 'rgba(10,12,20,0.88)' }}
    >
      <div
        className="pointer-events-none"
        style={{
          maxWidth: '560px',
          width: 'calc(100vw - 40px)',
          animation: 'death-text-in 0.4s ease-out',
        }}
      >
        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '18px' }}>
          <div
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '18px',
              color: '#fff',
              letterSpacing: '0.1em',
              textShadow: '4px 4px 0 #ff6b35, -2px -2px 0 #00e5ff',
              marginBottom: '8px',
            }}
          >
            WELCOME SOLDIER
          </div>
          <div
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '6px',
              color: '#4a4e5e',
              letterSpacing: '0.15em',
            }}
          >
            LEARN THE CONTROLS BEFORE YOU DEPLOY
          </div>
        </div>

        {/* Pixel divider */}
        <div style={{ display: 'flex', gap: '3px', justifyContent: 'center', margin: '14px auto' }}>
          {['#ff6b35', '#ffd600', '#76ff03', '#00e5ff', '#7c4dff'].map((c, i) => (
            <div key={i} style={{ width: '12px', height: '3px', background: c, opacity: 0.5 }} />
          ))}
        </div>

        {/* Control sections in a grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '20px',
            marginBottom: '20px',
          }}
        >
          {/* Movement */}
          <Section title="MOVEMENT" color="#76ff03">
            <ControlRow keyLabel={<><KeyBadge>W</KeyBadge><KeyBadge>A</KeyBadge><KeyBadge>S</KeyBadge><KeyBadge>D</KeyBadge></>} action="MOVE" />
            <ControlRow keyLabel={<KeyBadge>SPACE</KeyBadge>} action="JUMP" />
            <ControlRow keyLabel={<KeyBadge>SHIFT</KeyBadge>} action="SPRINT" />
            <ControlRow keyLabel={<KeyBadge>CTRL</KeyBadge>} action="CROUCH / SLIDE" />
            <ControlRow
              keyLabel={
                <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '5px', color: '#4a4e5e' }}>
                  SPACE+WALL
                </span>
              }
              action="WALL CLIMB"
            />
          </Section>

          {/* Combat */}
          <Section title="COMBAT" color="#ff2d78">
            <ControlRow keyLabel={<KeyBadge>LMB</KeyBadge>} action="FIRE" />
            <ControlRow keyLabel={<KeyBadge>R</KeyBadge>} action="RELOAD" />
            <ControlRow
              keyLabel={<><KeyBadge>1</KeyBadge><KeyBadge>2</KeyBadge><KeyBadge>3</KeyBadge></>}
              action="WEAPONS"
            />
            <ControlRow keyLabel={<KeyBadge>E</KeyBadge>} action="LOADOUT" />
            <ControlRow keyLabel={<KeyBadge>MOUSE</KeyBadge>} action="AIM" />
          </Section>

          {/* Actions */}
          <Section title="ACTIONS" color="#00e5ff">
            <ControlRow keyLabel={<KeyBadge>F</KeyBadge>} action="ENTER VEHICLE" />
            <ControlRow keyLabel={<KeyBadge>T</KeyBadge>} action="CHAT" />
            <ControlRow keyLabel={<KeyBadge>M</KeyBadge>} action="MAP" />
            <ControlRow keyLabel={<KeyBadge>ESC</KeyBadge>} action="SETTINGS" />
          </Section>
        </div>

        {/* Deploy button */}
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '14px',
              color: '#ff6b35',
              letterSpacing: '0.08em',
              textShadow: '3px 3px 0 #000',
              marginBottom: '8px',
              animation: 'hud-critical-flash 1.5s ease-in-out infinite',
            }}
          >
            CLICK TO DEPLOY
          </div>
          <div
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '5px',
              color: '#4a4e5e',
              letterSpacing: '0.1em',
            }}
          >
            CLICK ANYWHERE OR PRESS ANY KEY
          </div>
        </div>
      </div>
    </div>
  );
}
