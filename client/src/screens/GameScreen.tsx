import { useEffect, useRef, useState, useCallback } from 'react';
import { Engine } from '../game/Engine';
import type { EngineState } from '../game/Engine';
import { useGameStore } from '../store';
import { SettingsPanel } from './SettingsPanel';

interface DisplayMessage {
  id: number;
  senderName: string;
  text: string;
  sentAt: number;
}

const MAX_CHAT_MESSAGES = 80;

function getMessageTimestamp(sentAt: { toMillis?: () => bigint } | null | undefined): number {
  if (sentAt && typeof sentAt.toMillis === 'function') {
    return Number(sentAt.toMillis());
  }
  return Date.now();
}

function toDisplayMessage(msg: any): DisplayMessage {
  return {
    id: Number(msg.id),
    senderName: String(msg.senderName),
    text: String(msg.text),
    sentAt: getMessageTimestamp(msg.sentAt),
  };
}

function mergeMessages(prev: DisplayMessage[], next: DisplayMessage[]): DisplayMessage[] {
  const merged = new Map<number, DisplayMessage>();

  for (const message of prev) merged.set(message.id, message);
  for (const message of next) merged.set(message.id, message);

  return Array.from(merged.values())
    .sort((a, b) => (a.sentAt === b.sentAt ? a.id - b.id : a.sentAt - b.sentAt))
    .slice(-MAX_CHAT_MESSAGES);
}

function formatChatTime(sentAt: number): string {
  const date = new Date(sentAt);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

const WEAPON_DATA = [
  { name: 'RIFLE', key: '1', color: 'var(--c-blue)' },
  { name: 'SHOTGUN', key: '2', color: 'var(--c-amber)' },
  { name: 'RPG', key: '3', color: 'var(--c-red)' },
] as const;

export function GameScreen() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const { connection, setScreen, settings, showSettings, setShowSettings, identity } = useGameStore();

  const [state, setState] = useState<EngineState>({
    weapon: 0,
    ammo: 30,
    maxAmmo: 30,
    weaponName: 'Rifle',
    weaponColor: '#4488ff',
    fps: 0,
    locked: false,
    playerCount: 1,
    health: 100,
    kills: 0,
    deaths: 0,
    hitMarker: false,
    timeOfDay: '12:00',
    weather: 'Clear',
  });

  // ── Chat state ──
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [, chatTick] = useState(0); // forces re-render for message fading
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const localChatIdRef = useRef(-1);

  const pushLocalSystemMessage = useCallback((text: string) => {
    const nextId = localChatIdRef.current;
    localChatIdRef.current -= 1;

    setChatMessages((prev) =>
      mergeMessages(prev, [
        {
          id: nextId,
          senderName: '[SERVER]',
          text,
          sentAt: Date.now(),
        },
      ]),
    );
  }, []);

  // Load chat messages from DB + subscribe to new ones
  useEffect(() => {
    if (!connection) return;
    const db = connection.db as any;
    if (!db.chat_message) return;

    const initial = Array.from(db.chat_message.iter(), (msg: any) => toDisplayMessage(msg));
    setChatMessages(mergeMessages([], initial));

    const handleInsert = (_ctx: unknown, msg: any) => {
      setChatMessages((prev) => mergeMessages(prev, [toDisplayMessage(msg)]));
    };

    db.chat_message.onInsert(handleInsert);

    return () => {
      if (typeof db.chat_message.removeOnInsert === 'function') {
        db.chat_message.removeOnInsert(handleInsert);
      }
    };
  }, [connection]);

  // Periodic tick for message fading (when chat is closed)
  useEffect(() => {
    if (chatOpen) return;
    const interval = setInterval(() => chatTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [chatOpen]);

  // Focus chat input when opened
  useEffect(() => {
    if (chatOpen) {
      const timer = window.setTimeout(() => {
        const input = chatInputRef.current;
        if (!input) return;

        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;

    const frame = window.requestAnimationFrame(() => {
      const list = chatListRef.current;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, chatOpen]);

  const openChat = useCallback((initialText = '') => {
    setChatDraft(initialText);
    setChatOpen(true);
    engineRef.current?.setChatOpen(true);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatDraft('');
    engineRef.current?.setChatOpen(false);
  }, []);

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!connection || !text.trim()) return;
      const trimmed = text.trim();

      try {
        await connection.reducers.sendChat({ text: trimmed });
        if (trimmed.toLowerCase() === '/fly') {
          engineRef.current?.toggleFly();
        }
      } catch (error) {
        pushLocalSystemMessage(error instanceof Error ? error.message : 'Failed to send chat message');
      }
    },
    [connection, pushLocalSystemMessage],
  );

  const getMessageOpacity = useCallback(
    (sentAt: number): number => {
      if (chatOpen) return 1;
      const age = (Date.now() - sentAt) / 1000;
      if (age < 6) return 0.9;
      if (age < 10) return 0.9 * (1 - (age - 6) / 4);
      return 0;
    },
    [chatOpen],
  );

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || engineRef.current) return;

    engineRef.current = new Engine(container, connection, setState, identity);
    engineRef.current.updateSettings(settings);

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [connection]);

  // Sync settings to engine when they change
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateSettings(settings);
    }
  }, [settings]);

  // Global key handler: Escape (settings), T (chat)
  const handleGlobalKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }

      // When chat is open, only Escape closes it (handled by input)
      if (chatOpen) return;

      if (e.code === 'Escape') {
        setShowSettings(!showSettings);
      }
      if ((e.code === 'KeyT' || e.code === 'Slash') && state.locked && !showSettings) {
        e.preventDefault();
        openChat(e.code === 'Slash' ? '/' : '');
      }
    },
    [chatOpen, showSettings, setShowSettings, state.locked, openChat],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, [handleGlobalKey]);

  const handleLeave = () => setScreen('lobby');
  const healthColor = state.health > 50 ? 'var(--c-green)' : state.health > 25 ? 'var(--c-amber)' : 'var(--c-red)';

  return (
    <div className="flex flex-col h-full relative">
      {/* Game Canvas */}
      <div ref={canvasRef} className="absolute inset-0" />

      {/* Settings Panel */}
      {showSettings && <SettingsPanel />}

      {/* ═══ HUD OVERLAY ═══ */}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{
            background: 'linear-gradient(180deg, rgba(6,8,16,0.7) 0%, transparent 100%)',
          }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={handleLeave}
              className="pointer-events-auto cursor-pointer px-3 py-1"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                background: 'rgba(6,8,16,0.6)',
                border: '1px solid var(--c-border)',
                letterSpacing: '0.1em',
                transition: 'all 0.2s',
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
              [ESC] EXIT
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="pointer-events-auto cursor-pointer px-3 py-1"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: showSettings ? 'var(--c-green)' : 'var(--c-muted)',
                background: 'rgba(6,8,16,0.6)',
                border: `1px solid ${showSettings ? 'var(--c-green)' : 'var(--c-border)'}`,
                letterSpacing: '0.1em',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--c-green)';
                e.currentTarget.style.color = 'var(--c-green)';
              }}
              onMouseLeave={(e) => {
                if (!showSettings) {
                  e.currentTarget.style.borderColor = 'var(--c-border)';
                  e.currentTarget.style.color = 'var(--c-muted)';
                }
              }}
            >
              SETTINGS
            </button>
          </div>

          <div className="flex items-center gap-4">
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                letterSpacing: '0.1em',
              }}
            >
              <span style={{ color: 'var(--c-blue)' }}>{state.timeOfDay}</span>{' '}
              <span style={{ color: 'var(--c-muted2)' }}>{state.weather}</span>
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                letterSpacing: '0.1em',
              }}
            >
              <span style={{ color: 'var(--c-green-dim)' }}>{state.playerCount}</span> ACTIVE
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted2)',
              }}
            >
              {state.fps} FPS
            </span>
          </div>
        </div>
      </div>

      {/* Crosshair + Hit Marker */}
      {state.locked && !chatOpen && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="relative" style={{ width: '24px', height: '24px' }}>
            {/* Top */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '0', width: '2px', height: '7px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Bottom */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: '0', width: '2px', height: '7px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Left */}
            <div className="absolute top-1/2 -translate-y-1/2" style={{ left: '0', width: '7px', height: '2px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Right */}
            <div className="absolute top-1/2 -translate-y-1/2" style={{ right: '0', width: '7px', height: '2px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Center dot */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: '2px', height: '2px', background: 'rgba(255,255,255,0.9)' }} />

            {/* Hit marker X — flashes on block hit */}
            {state.hitMarker && (
              <>
                <div className="absolute top-1/2 left-1/2" style={{
                  width: '14px', height: '2px',
                  background: 'rgba(255,255,255,0.95)',
                  transform: 'translate(-50%, -50%) rotate(45deg)',
                  boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                }} />
                <div className="absolute top-1/2 left-1/2" style={{
                  width: '14px', height: '2px',
                  background: 'rgba(255,255,255,0.95)',
                  transform: 'translate(-50%, -50%) rotate(-45deg)',
                  boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                }} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Click to play overlay */}
      {!state.locked && !showSettings && !chatOpen && (
        <div
          className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer"
          onClick={() => canvasRef.current?.requestPointerLock()}
          style={{ background: 'rgba(6,8,16,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div className="text-center pointer-events-none">
            <div
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '20px',
                color: 'var(--c-green)',
                letterSpacing: '0.05em',
                marginBottom: '8px',
                textShadow: '0 0 20px rgba(0,255,65,0.5)',
              }}
            >
              CLICK TO DEPLOY
            </div>
            <div className="hr-tactical" style={{ width: '200px', margin: '16px auto' }} />
            <div
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                letterSpacing: '0.15em',
                lineHeight: '2.2',
                animationDelay: '0.2s',
              }}
            >
              <div className="flex justify-center gap-8">
                <span><span style={{ color: 'var(--c-text)' }}>WASD</span> MOVE</span>
                <span><span style={{ color: 'var(--c-text)' }}>MOUSE</span> AIM</span>
                <span><span style={{ color: 'var(--c-text)' }}>LMB</span> FIRE</span>
              </div>
              <div className="flex justify-center gap-8">
                <span><span style={{ color: 'var(--c-text)' }}>SPACE</span> JUMP</span>
                <span><span style={{ color: 'var(--c-text)' }}>R</span> RELOAD</span>
                <span><span style={{ color: 'var(--c-text)' }}>1-3</span> WEAPONS</span>
              </div>
              <div className="flex justify-center gap-8">
                <span><span style={{ color: 'var(--c-text)' }}>SHIFT</span> SPRINT</span>
                <span><span style={{ color: 'var(--c-text)' }}>CTRL</span> CROUCH</span>
                <span><span style={{ color: 'var(--c-text)' }}>T</span> CHAT</span>
                <span><span style={{ color: 'var(--c-text)' }}>ESC</span> SETTINGS</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CHAT OVERLAY ═══ */}
      <div
        className="absolute z-10"
        style={{
          bottom: '140px',
          left: '16px',
          width: 'min(420px, calc(100vw - 32px))',
          pointerEvents: chatOpen ? 'auto' : 'none',
        }}
      >
        {chatOpen && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '6px',
              padding: '0 2px',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.12em',
              color: 'var(--c-muted2)',
            }}
          >
            <span style={{ color: 'var(--c-green)' }}>COMMS</span>
            <span>/help for commands</span>
          </div>
        )}

        {/* Message list */}
        <div
          ref={chatListRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            maxHeight: chatOpen ? '260px' : '140px',
            overflowY: chatOpen ? 'auto' : 'hidden',
            padding: chatOpen ? '10px' : '0',
            background: chatOpen ? 'linear-gradient(180deg, rgba(6,8,16,0.9) 0%, rgba(6,8,16,0.72) 100%)' : 'transparent',
            border: chatOpen ? '1px solid var(--c-border)' : 'none',
            borderRadius: '6px',
            boxShadow: chatOpen ? '0 20px 48px rgba(0,0,0,0.34)' : 'none',
            backdropFilter: chatOpen ? 'blur(10px)' : 'none',
            overscrollBehavior: 'contain',
            scrollbarGutter: 'stable',
          }}
        >
          {chatMessages
            .filter((m) => chatOpen || getMessageOpacity(m.sentAt) > 0.01)
            .slice(chatOpen ? -40 : -8)
            .map((msg) => {
              const isSystem = msg.senderName === '[SERVER]';
              const opacity = getMessageOpacity(msg.sentAt);
              return (
                <div
                  key={msg.id}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    lineHeight: '1.45',
                    opacity,
                    padding: chatOpen ? '7px 8px' : '2px 6px',
                    background: isSystem ? 'rgba(255,184,0,0.08)' : 'rgba(6,8,16,0.52)',
                    border: chatOpen ? `1px solid ${isSystem ? 'rgba(255,184,0,0.22)' : 'rgba(128,255,179,0.12)'}` : 'none',
                    borderRadius: '4px',
                    transition: 'opacity 0.5s',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '8px',
                      marginBottom: '2px',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--c-muted2)',
                        fontSize: '9px',
                        letterSpacing: '0.08em',
                        minWidth: '38px',
                      }}
                    >
                      {formatChatTime(msg.sentAt)}
                    </span>
                    <span
                      style={{
                        color: isSystem ? 'var(--c-amber)' : 'var(--c-green)',
                        fontWeight: 600,
                      }}
                    >
                      {msg.senderName}
                    </span>
                  </div>
                  <span
                    style={{
                      color: isSystem ? 'var(--c-amber)' : 'var(--c-text)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {msg.text}
                  </span>
                </div>
              );
            })}
        </div>

        {/* Chat input */}
        {chatOpen && (
          <div style={{ marginTop: '4px' }}>
            <input
              ref={chatInputRef}
              autoFocus
              maxLength={200}
              value={chatDraft}
              placeholder="Message or command"
              onChange={(e) => setChatDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (chatDraft.trim()) void sendChatMessage(chatDraft);
                  closeChat();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeChat();
                }
              }}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                background: 'rgba(6,8,16,0.85)',
                border: '1px solid var(--c-border)',
                color: 'var(--c-text)',
                padding: '8px 10px',
                outline: 'none',
                borderRadius: '4px',
                boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
              }}
            />
          </div>
        )}

        {/* Chat hint when not open */}
        {!chatOpen && state.locked && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: 'var(--c-muted2)',
              marginTop: '4px',
              letterSpacing: '0.1em',
            }}
          >
            [T] CHAT  [/ ] COMMANDS
          </div>
        )}
      </div>

      {/* ═══ BOTTOM HUD ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div
          className="px-4 pb-4 pt-12"
          style={{
            background: 'linear-gradient(0deg, rgba(6,8,16,0.6) 0%, transparent 100%)',
          }}
        >
          <div className="flex items-end justify-between">

            {/* LEFT: Health + Weapon */}
            <div className="flex flex-col gap-2">
              {/* Health */}
              <div
                className="flex items-center gap-3 px-3 py-2"
                style={{
                  background: 'rgba(6,8,16,0.7)',
                  border: '1px solid var(--c-border)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    color: 'var(--c-muted)',
                    letterSpacing: '0.1em',
                  }}
                >
                  HP
                </span>
                <div
                  style={{
                    width: '100px',
                    height: '4px',
                    background: 'var(--c-border)',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${state.health}%`,
                      background: healthColor,
                      transition: 'all 0.3s ease',
                      boxShadow: `0 0 8px ${healthColor}`,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color: healthColor,
                    fontWeight: 'bold',
                    minWidth: '30px',
                    textAlign: 'right',
                    textShadow: `0 0 10px ${healthColor}`,
                  }}
                >
                  {state.health}
                </span>
              </div>

              {/* Weapon + Ammo */}
              <div
                className="flex items-center gap-4 px-3 py-2"
                style={{
                  background: 'rgba(6,8,16,0.7)',
                  border: '1px solid var(--c-border)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: '16px',
                    fontWeight: 700,
                    color: WEAPON_DATA[state.weapon].color,
                    letterSpacing: '0.1em',
                    textShadow: `0 0 10px ${WEAPON_DATA[state.weapon].color}`,
                  }}
                >
                  {WEAPON_DATA[state.weapon].name}
                </span>
                <div style={{ width: '1px', height: '16px', background: 'var(--c-border)' }} />
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '18px',
                    color: state.ammo === 0 ? 'var(--c-red)' : 'var(--c-text)',
                    fontWeight: 'bold',
                  }}
                >
                  {state.ammo}
                  <span style={{ fontSize: '11px', color: 'var(--c-muted)', fontWeight: 'normal' }}>
                    /{state.maxAmmo}
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT: K/D + Weapon slots */}
            <div className="flex flex-col items-end gap-2">
              {/* K/D */}
              <div
                className="flex items-center gap-3 px-3 py-1"
                style={{
                  background: 'rgba(6,8,16,0.7)',
                  border: '1px solid var(--c-border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span style={{ color: 'var(--c-muted)', fontSize: '9px', letterSpacing: '0.1em' }}>KILLS</span>
                <span style={{ color: 'var(--c-green)', fontWeight: 'bold' }}>{state.kills}</span>
                <div style={{ width: '1px', height: '12px', background: 'var(--c-border)' }} />
                <span style={{ color: 'var(--c-muted)', fontSize: '9px', letterSpacing: '0.1em' }}>DEATHS</span>
                <span style={{ color: 'var(--c-red)', fontWeight: 'bold' }}>{state.deaths}</span>
              </div>

              {/* Weapon slots */}
              <div className="flex gap-1">
                {WEAPON_DATA.map((w, i) => {
                  const active = state.weapon === i;
                  return (
                    <div
                      key={w.name}
                      className="flex items-center gap-1 px-3 py-2"
                      style={{
                        background: active ? 'rgba(255,255,255,0.07)' : 'rgba(6,8,16,0.7)',
                        border: active ? `1px solid ${w.color}` : '1px solid var(--c-border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        letterSpacing: '0.05em',
                        transition: 'all 0.15s ease',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      <span style={{ color: 'var(--c-muted)', fontSize: '9px' }}>{w.key}</span>
                      <span style={{ color: active ? w.color : 'var(--c-muted)' }}>{w.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
