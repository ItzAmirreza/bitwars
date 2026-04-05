import { useEffect, useRef, useState, useCallback } from 'react';
import { Engine } from '../game/Engine';
import type { EngineLivePerfSnapshot } from '../game/Engine';
import type { EngineState } from '../game/Engine';
import { PerfHarness, buildPerfHooks } from '../game/PerfHarness';
import type { PerfRunResult } from '../game/PerfHarness';
import type { PerfRunSummary } from '../game/PerfHistoryStore';
import { useGameStore } from '../store';
import { SettingsPanel } from './SettingsPanel';
import { PerfPanel } from './PerfPanel';
import { LoadoutOverlay } from './hud/LoadoutOverlay';
import { KillFeed } from './hud/KillFeed';
import { TopHudBar } from './hud/TopHudBar';
import { BottomHud } from './hud/BottomHud';
import { Crosshair } from './hud/Crosshair';
import { ChatOverlay } from './hud/ChatOverlay';
import { DeathScreen } from './hud/DeathScreen';
import { BuffIndicators } from './hud/BuffIndicators';
import { MatchVictoryOverlay } from './hud/MatchVictoryOverlay';
import { LivePerfOverlay } from './hud/LivePerfOverlay';
import { TacticalMapOverlay, TacticalMinimap } from './hud/TacticalMap';
import { useKillTracking } from './hooks/useKillTracking';
import { useChat } from './hooks/useChat';
import { useMatchSession } from './hooks/useMatchSession';
import { useTacticalMap } from './hooks/useTacticalMap';

interface GameScreenProps {
  active: boolean;
}

export function GameScreen({ active }: GameScreenProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const { connection, setScreen, settings, showSettings, setShowSettings, identity, username } = useGameStore();
  const activeConnection = active ? connection : null;
  const activeRef = useRef(active);
  const settingsRef = useRef(settings);
  const identityRef = useRef(identity);
  const usernameRef = useRef(username);

  activeRef.current = active;
  settingsRef.current = settings;
  identityRef.current = identity;
  usernameRef.current = username;

  const [state, setState] = useState<EngineState>({
    weapon: 0,
    loadout: [0, 1, 2],
    ammo: 90,
    maxAmmo: 90,
    weaponName: 'Rifle',
    weaponColor: '#4488ff',
    fps: 0,
    serverTps: 0,
    locked: false,
    playerCount: 1,
    health: 100,
    kills: 0,
    deaths: 0,
    hitMarker: false,
    hitMarkerType: 'none',
    timeOfDay: '12:00',
    weather: 'Clear',
    heading: 0,
    isReloading: false,
    worldReady: false,
    worldLoadProgress: 0,
    mountedVehicleName: null,
    vehicleAltitude: 0,
    vehicleHealth: 0,
    vehicleMaxHealth: 1000,
    vehicleWeapon: 0,
    vehicleWeaponName: 'MINIGUN',
    vehicleAmmo: 0,
    vehicleMaxAmmo: 300,
    vehicleSpeed: 0,
    vehicleThrottle: 0,
    vehicleReloading: false,
    vehicleWeaponSlots: [{ name: 'MINIGUN', color: '#ffaa00' }, { name: 'ROCKETS', color: '#ff4400' }],
    aaTargets: [],
    nearVehicle: false,
    nearVehicleName: null,
    activeBuffs: [],
    damageIndicators: [],
    sniperScoped: false,
  });

  // ── Kill tracking hook ──
  const { killFeed, killNotifications, isDead, respawnCountdown } = useKillTracking(
    state.kills,
    state.deaths,
    state.health,
    activeConnection,
  );

  // ── Chat hook ──
  const {
    chatMessages,
    chatDraft,
    setChatDraft,
    sendChatMessage,
    pushLocalSystemMessage,
    chatCooldownRemainingMs,
    chatStatusText,
  } = useChat(activeConnection, identity);

  // ── Chat state ──
  const [chatOpen, setChatOpen] = useState(false);
  const [loadoutOpen, setLoadoutOpen] = useState(false);
  const [loadoutDraft, setLoadoutDraft] = useState<[number, number, number]>([0, 1, 2]);
  const [activeLoadoutSlot, setActiveLoadoutSlot] = useState(0);
  const [savingLoadout, setSavingLoadout] = useState(false);
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [showLivePerfOverlay, setShowLivePerfOverlay] = useState(false);
  const [tacticalMapOpen, setTacticalMapOpen] = useState(false);
  const [perfRunning, setPerfRunning] = useState(false);
  const [perfProgress, setPerfProgress] = useState(0);
  const [perfLastRun, setPerfLastRun] = useState<PerfRunResult | null>(null);
  const [perfSummaries, setPerfSummaries] = useState<PerfRunSummary[]>([]);
  const [perfSelectedRun, setPerfSelectedRun] = useState<PerfRunResult | null>(null);
  const [perfCompareRun, setPerfCompareRun] = useState<PerfRunResult | null>(null);
  const [livePerfSnapshot, setLivePerfSnapshot] = useState<EngineLivePerfSnapshot | null>(null);

  const perfHarnessRef = useRef<PerfHarness | null>(null);
  const perfTickerRef = useRef<number | null>(null);
  const matchSession = useMatchSession(activeConnection, identity);
  const tacticalMap = useTacticalMap(activeConnection, identity, active);

  const closeLoadout = useCallback(() => {
    setLoadoutOpen(false);
    setSavingLoadout(false);
    engineRef.current?.setLoadoutMenuOpen(false);
  }, []);

  const closeTacticalMap = useCallback(() => {
    setTacticalMapOpen(false);
    engineRef.current?.setTacticalMapOpen(false);
  }, []);

  const openLoadout = useCallback(() => {
    if (chatOpen) {
      setChatOpen(false);
      setChatDraft('');
      engineRef.current?.setChatOpen(false);
    }
    if (tacticalMapOpen) {
      closeTacticalMap();
    }
    setLoadoutDraft(state.loadout);
    setActiveLoadoutSlot(0);
    setLoadoutOpen(true);
    engineRef.current?.setLoadoutMenuOpen(true);
  }, [chatOpen, tacticalMapOpen, closeTacticalMap, state.loadout, setChatDraft]);

  const assignWeaponToSlot = useCallback((slot: number, weaponIndex: number) => {
    setLoadoutDraft((prev) => {
      const next = [...prev] as [number, number, number];
      const existing = next.indexOf(weaponIndex);
      if (existing >= 0 && existing !== slot) {
        next[existing] = next[slot];
      }
      next[slot] = weaponIndex;
      return next;
    });
  }, []);

  const saveLoadout = useCallback(async () => {
    if (!connection || savingLoadout) return;

    setSavingLoadout(true);
    try {
      await (connection.reducers as any).setLoadout({
        slot1: loadoutDraft[0],
        slot2: loadoutDraft[1],
        slot3: loadoutDraft[2],
      });
      engineRef.current?.setLoadout(loadoutDraft, state.weapon);
      closeLoadout();
    } catch (error) {
      pushLocalSystemMessage(error instanceof Error ? error.message : 'Failed to save loadout');
      setSavingLoadout(false);
    }
  }, [connection, savingLoadout, loadoutDraft, state.weapon, closeLoadout, pushLocalSystemMessage]);

  const openChat = useCallback((initialText = '') => {
    if (loadoutOpen) {
      closeLoadout();
    }
    if (tacticalMapOpen) {
      closeTacticalMap();
    }
    setChatDraft(initialText);
    setChatOpen(true);
    engineRef.current?.setChatOpen(true);
  }, [loadoutOpen, tacticalMapOpen, closeLoadout, closeTacticalMap, setChatDraft]);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatDraft('');
    engineRef.current?.setChatOpen(false);
  }, [setChatDraft]);

  const toggleTacticalMap = useCallback(() => {
    if (chatOpen) {
      closeChat();
    }
    if (loadoutOpen) {
      closeLoadout();
    }
    setTacticalMapOpen((value) => !value);
  }, [chatOpen, loadoutOpen, closeChat, closeLoadout]);

  const handleSendChatMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return false;
      const trimmed = text.trim();

      const success = await sendChatMessage(trimmed);
      if (success && trimmed.toLowerCase() === '/fly') {
        engineRef.current?.toggleFly();
      }
      return success;
    },
    [sendChatMessage],
  );

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || !connection || engineRef.current) return;

    let disposed = false;
    const engineInitFrame = requestAnimationFrame(() => {
      if (disposed || !connection || engineRef.current) return;
      const engine = new Engine(container, connection, setState, null, null, activeRef.current);
      engine.setPlayerContext(identityRef.current, usernameRef.current || null);
      engine.updateSettings(settingsRef.current);
      engineRef.current = engine;

      const harness = new PerfHarness(buildPerfHooks(engine));
      perfHarnessRef.current = harness;

      const maybeOpenPerf = sessionStorage.getItem('bitwars-open-perf') === '1';
      if (maybeOpenPerf) {
        sessionStorage.removeItem('bitwars-open-perf');
        setShowPerfPanel(true);
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(engineInitFrame);
      if (perfTickerRef.current !== null) {
        clearInterval(perfTickerRef.current);
        perfTickerRef.current = null;
      }
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
      perfHarnessRef.current = null;
    };
  }, [connection]);

  useEffect(() => {
    engineRef.current?.setPlayerContext(identity, username || null);
  }, [identity, username]);

  useEffect(() => {
    if (!active || !showLivePerfOverlay) return;

    const sync = () => {
      setLivePerfSnapshot(engineRef.current?.getLivePerfSnapshot() ?? null);
    };

    sync();
    const timer = window.setInterval(sync, 120);
    return () => clearInterval(timer);
  }, [active, showLivePerfOverlay]);

  useEffect(() => {
    engineRef.current?.setActive(active);
    if (!active) {
      engineRef.current?.setChatOpen(false);
      engineRef.current?.setLoadoutMenuOpen(false);
    }
  }, [active]);

  const refreshPerfHistory = useCallback(async () => {
    const harness = perfHarnessRef.current;
    if (!harness) return;
    const rows = await harness.history(30);
    setPerfSummaries(rows);
  }, []);

  const selectPerfRun = useCallback(async (id: string) => {
    const harness = perfHarnessRef.current;
    if (!harness) return;
    const run = await harness.loadRun(id);
    setPerfSelectedRun(run);
  }, []);

  const selectPerfCompareRun = useCallback(async (id: string) => {
    if (!id) {
      setPerfCompareRun(null);
      return;
    }
    const harness = perfHarnessRef.current;
    if (!harness) return;
    const run = await harness.loadRun(id);
    setPerfCompareRun(run);
  }, []);

  const deletePerfRun = useCallback(async (id: string) => {
    const harness = perfHarnessRef.current;
    if (!harness) return;
    await harness.deleteRun(id);
    if (perfSelectedRun?.id === id) setPerfSelectedRun(null);
    if (perfCompareRun?.id === id) setPerfCompareRun(null);
    await refreshPerfHistory();
  }, [perfSelectedRun, perfCompareRun, refreshPerfHistory]);

  const clearPerfRuns = useCallback(async () => {
    const harness = perfHarnessRef.current;
    if (!harness) return;
    await harness.clearHistory();
    setPerfSelectedRun(null);
    setPerfCompareRun(null);
    setPerfLastRun(null);
    await refreshPerfHistory();
  }, [refreshPerfHistory]);

  const exportPerfRun = useCallback(async (id: string) => {
    const harness = perfHarnessRef.current;
    if (!harness) return;
    const run = await harness.loadRun(id);
    if (!run) return;
    const json = harness.exportRun(run);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importPerfRun = useCallback(async (jsonText: string) => {
    const harness = perfHarnessRef.current;
    if (!harness) return;
    const parsed = harness.parseImportedRun(jsonText);
    if (!parsed) return;
    const imported = { ...parsed, id: `${parsed.id}-import-${Date.now()}` };
    await harness.saveImportedRun(imported);
    await refreshPerfHistory();
  }, [refreshPerfHistory]);

  const runPerfHarness = useCallback(async () => {
    const harness = perfHarnessRef.current;
    if (!harness || perfRunning) return;
    const ok = harness.start(65, 'full');
    if (!ok) return;

    const reopenPerfPanelAfterRun = showPerfPanel;

    setPerfRunning(true);
    setPerfProgress(0);
    setPerfSelectedRun(null);
    setShowPerfPanel(false);

    const started = performance.now();
    if (perfTickerRef.current !== null) {
      clearInterval(perfTickerRef.current);
      perfTickerRef.current = null;
    }

    perfTickerRef.current = window.setInterval(async () => {
      const h = perfHarnessRef.current;
      if (!h) return;
      const run = await h.tick();
      const elapsed = (performance.now() - started) / 1000;
      setPerfProgress(Math.max(0, Math.min(1, elapsed / 65)));
      if (run) {
        if (perfTickerRef.current !== null) {
          clearInterval(perfTickerRef.current);
          perfTickerRef.current = null;
        }
        setPerfRunning(false);
        setPerfProgress(1);
        setPerfLastRun(run);
        setPerfSelectedRun(run);
        if (reopenPerfPanelAfterRun) setShowPerfPanel(true);
        await refreshPerfHistory();
      }
    }, 16);
  }, [perfRunning, refreshPerfHistory, showPerfPanel]);

  // Sync settings to engine when they change
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateSettings(settings);
    }
  }, [settings]);

  useEffect(() => {
    engineRef.current?.setTacticalMapOpen(tacticalMapOpen);
  }, [tacticalMapOpen]);

  useEffect(() => {
    if (showSettings && tacticalMapOpen) {
      closeTacticalMap();
    }
  }, [showSettings, tacticalMapOpen, closeTacticalMap]);

  // Global key handler: Escape (menus), T (chat), E (loadout), M (map)
  const handleGlobalKey = useCallback(
    (e: KeyboardEvent) => {
      if (!active) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }

      if (e.code === 'F7') {
        e.preventDefault();
        setShowLivePerfOverlay((value) => {
          const next = !value;
          if (next) {
            setLivePerfSnapshot(engineRef.current?.getLivePerfSnapshot() ?? null);
          }
          return next;
        });
        return;
      }

      if (e.code === 'F8') {
        e.preventDefault();
        setShowPerfPanel((v) => !v);
        return;
      }

      if (e.code === 'F9') {
        e.preventDefault();
        engineRef.current?.toggleChunkBoundaries();
        return;
      }

      if (chatOpen || loadoutOpen || tacticalMapOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          if (chatOpen) closeChat();
          else if (loadoutOpen) closeLoadout();
          else closeTacticalMap();
        }
        if (loadoutOpen && e.code === 'KeyE') {
          e.preventDefault();
          closeLoadout();
        }
        if (tacticalMapOpen && e.code === 'KeyM') {
          e.preventDefault();
          closeTacticalMap();
        }
        if (loadoutOpen && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
          e.preventDefault();
          setActiveLoadoutSlot(Number(e.code.charAt(5)) - 1);
        }
        return;
      }

      if (e.code === 'KeyM' && state.worldReady && !showSettings) {
        e.preventDefault();
        toggleTacticalMap();
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        setShowSettings(!showSettings);
        return;
      }

      if (e.code === 'KeyE' && state.locked && !showSettings && !state.mountedVehicleName) {
        e.preventDefault();
        openLoadout();
        return;
      }

      if ((e.code === 'KeyT' || e.code === 'Slash') && state.locked && !showSettings) {
        e.preventDefault();
        openChat(e.code === 'Slash' ? '/' : '');
      }
    },
    [active, chatOpen, loadoutOpen, tacticalMapOpen, showSettings, setShowSettings, state.locked, state.mountedVehicleName, state.worldReady, openChat, openLoadout, closeChat, closeLoadout, closeTacticalMap, toggleTacticalMap],
  );

  useEffect(() => {
    if (!active) return;
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, [active, handleGlobalKey]);

  const handleLeave = useCallback(() => {
    closeChat();
    closeLoadout();
    closeTacticalMap();
    setShowSettings(false);
    setShowPerfPanel(false);
    setScreen('lobby');
  }, [closeChat, closeLoadout, closeTacticalMap, setShowSettings, setScreen]);
  const isLowHealth = state.health > 0 && state.health <= 25;
  const isCriticalHealth = state.health > 0 && state.health <= 10;
  const loadingPercent = Math.max(0, Math.min(100, Math.round(state.worldLoadProgress * 100)));
  const hudOverlayOpen = chatOpen || loadoutOpen || tacticalMapOpen;

  return (
    <div
      className="flex flex-col h-full relative"
      style={{ visibility: active ? 'visible' : 'hidden', pointerEvents: active ? 'auto' : 'none' }}
    >
      {/* Game Canvas */}
      <div ref={canvasRef} className="absolute inset-0" />

      {/* Settings Panel */}
      {showSettings && <SettingsPanel />}

      {perfRunning && !showPerfPanel && (
        <div
          className="absolute top-3 right-3 z-30"
          style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '7px',
            letterSpacing: '0.08em',
            color: '#00e5ff',
            border: '2px solid #1a1e2e',
            background: 'rgba(12,16,24,0.85)',
            padding: '5px 8px',
          }}
        >
          PERF TEST {Math.round(perfProgress * 100)}%
        </div>
      )}

      <PerfPanel
        open={showPerfPanel}
        running={perfRunning}
        progress={perfProgress}
        lastRun={perfLastRun}
        summaries={perfSummaries}
        selectedRun={perfSelectedRun}
        compareRun={perfCompareRun}
        onClose={() => setShowPerfPanel(false)}
        onRun={runPerfHarness}
        onRefresh={refreshPerfHistory}
        onSelectRun={selectPerfRun}
        onSelectCompareRun={selectPerfCompareRun}
        onDeleteRun={deletePerfRun}
        onClear={clearPerfRuns}
        onExportRun={exportPerfRun}
        onImportRun={importPerfRun}
      />

      <LivePerfOverlay
        open={showLivePerfOverlay}
        snapshot={livePerfSnapshot}
      />

      {/* Startup world streaming overlay */}
      {!state.worldReady && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{
            background: 'rgba(10,12,20,0.94)',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ width: 'min(460px, calc(100vw - 40px))' }}>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '14px',
              letterSpacing: '0.08em',
              color: '#fff',
              textAlign: 'center',
              textShadow: '3px 3px 0 #ff6b35',
              marginBottom: '10px',
            }}>
              LOADING COMBAT ZONE
            </div>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '7px',
              letterSpacing: '0.15em',
              color: '#6b7080',
              textAlign: 'center',
              marginBottom: '14px',
            }}>
              STREAMING NEARBY TERRAIN
            </div>
            <div style={{
              height: '12px',
              border: '2px solid #1a1e2e',
              background: 'rgba(12,16,24,0.9)',
              padding: '1px',
            }}>
              <div style={{
                width: `${loadingPercent}%`,
                height: '100%',
                background: '#ff6b35',
                transition: 'width 160ms steps(8)',
              }} />
            </div>
            <div style={{
              marginTop: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              letterSpacing: '0.1em',
              color: '#ff6b35',
              textAlign: 'center',
            }}>
              {loadingPercent}%
            </div>
            <div style={{
              marginTop: '8px',
              fontFamily: 'var(--font-pixel)',
              fontSize: '6px',
              letterSpacing: '0.1em',
              color: '#4a4e5e',
              textAlign: 'center',
            }}>
              MOVEMENT LOCKED UNTIL READY
            </div>
          </div>
        </div>
      )}

      {/* ═══ LOW HEALTH SCREEN EFFECTS ═══ */}
      {isLowHealth && state.locked && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            boxShadow: `inset 0 0 ${isCriticalHealth ? '120px' : '80px'} ${isCriticalHealth ? '40px' : '20px'} rgba(255,0,30,${isCriticalHealth ? 0.3 : 0.15})`,
            animation: isCriticalHealth ? 'low-hp-pulse 0.6s ease-in-out infinite' : 'low-hp-pulse 1s ease-in-out infinite',
          }}
        />
      )}

      {/* ═══ DEATH SCREEN OVERLAY ═══ */}
      {isDead && (
        <DeathScreen
          respawnCountdown={respawnCountdown}
          kills={state.kills}
          deaths={state.deaths}
        />
      )}

      {/* ═══ LOADOUT OVERLAY ═══ */}
      {loadoutOpen && (
        <LoadoutOverlay
          loadoutDraft={loadoutDraft}
          activeLoadoutSlot={activeLoadoutSlot}
          savingLoadout={savingLoadout}
          assignWeaponToSlot={assignWeaponToSlot}
          saveLoadout={saveLoadout}
          closeLoadout={closeLoadout}
          setActiveLoadoutSlot={setActiveLoadoutSlot}
        />
      )}

      {/* ═══ BUFF INDICATORS ═══ */}
      <BuffIndicators buffs={state.activeBuffs ?? []} />

      {/* ═══ KILL FEED ═══ */}
      <KillFeed
        killFeed={killFeed}
        killNotifications={killNotifications}
        username={username}
      />

      {matchSession.showEndingWarning && state.locked && (
        <div className="absolute top-20 left-1/2 z-20 pointer-events-none" style={{ transform: 'translateX(-50%)' }}>
          <div
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '9px',
              letterSpacing: '0.16em',
              color: '#ff2d78',
              border: '2px solid #ff2d78',
              background: 'rgba(12,16,24,0.9)',
              padding: '8px 14px',
              animation: 'hud-critical-flash 1s ease-in-out infinite',
            }}
          >
            {matchSession.endingWarningText}
          </div>
        </div>
      )}

      {matchSession.result && (
        <MatchVictoryOverlay
          result={matchSession.result}
          nextRoundTimer={matchSession.intermissionTimerText}
        />
      )}

      {/* ═══ TOP HUD BAR ═══ */}
      <TopHudBar
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        showLivePerfOverlay={showLivePerfOverlay}
        toggleLivePerfOverlay={() => {
          setShowLivePerfOverlay((value) => {
            const next = !value;
            if (next) {
              setLivePerfSnapshot(engineRef.current?.getLivePerfSnapshot() ?? null);
            }
            return next;
          });
        }}
        loadoutOpen={loadoutOpen}
        chatOpen={chatOpen}
        username={username}
        roundTimerLabel={matchSession.timerLabel}
        roundTimer={matchSession.timerText}
        roundTimerCritical={matchSession.timerCritical}
        playerCount={state.playerCount}
        fps={state.fps}
        serverTps={state.serverTps}
        heading={state.heading}
        locked={state.locked}
        handleLeave={handleLeave}
        openLoadout={openLoadout}
      />

      {state.worldReady && !showSettings && (
        <TacticalMinimap
          snapshot={tacticalMap}
          heading={state.heading}
          side={settings.minimapSide}
        />
      )}

      <TacticalMapOverlay
        open={tacticalMapOpen && state.worldReady}
        snapshot={tacticalMap}
        heading={state.heading}
      />

      {/* ═══ CROSSHAIR + HIT MARKER ═══ */}
      {state.locked && !hudOverlayOpen && !matchSession.weaponsDisabled && (
        <Crosshair
          hitMarker={state.hitMarker}
          hitMarkerType={state.hitMarkerType}
          mountedVehicleName={state.mountedVehicleName}
          vehicleWeapon={state.vehicleWeapon}
          vehicleWeaponColor={state.vehicleWeaponSlots[state.vehicleWeapon]?.color}
          damageIndicators={state.damageIndicators}
          sniperScoped={state.sniperScoped}
        />
      )}

      {/* ═══ AA CRAM TARGET TRACKING HUD ═══ */}
      {state.locked && !hudOverlayOpen && state.aaTargets.length > 0 && (
        <div className="absolute inset-0 pointer-events-none z-10">
          {state.aaTargets.map((t, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${t.screenX * 100}%`,
              top: `${t.screenY * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}>
              {/* Diamond bracket marker */}
              <svg width="40" height="40" viewBox="0 0 40 40" style={{ display: 'block' }}>
                <rect
                  x="6" y="6" width="28" height="28"
                  rx="1"
                  transform="rotate(45 20 20)"
                  fill="none"
                  stroke="#ff3333"
                  strokeWidth="2"
                  opacity={0.85}
                />
                {/* Corner ticks */}
                <line x1="20" y1="2" x2="20" y2="7" stroke="#ff3333" strokeWidth="1.5" opacity="0.7" />
                <line x1="20" y1="33" x2="20" y2="38" stroke="#ff3333" strokeWidth="1.5" opacity="0.7" />
                <line x1="2" y1="20" x2="7" y2="20" stroke="#ff3333" strokeWidth="1.5" opacity="0.7" />
                <line x1="33" y1="20" x2="38" y2="20" stroke="#ff3333" strokeWidth="1.5" opacity="0.7" />
              </svg>
              {/* Distance label */}
              <div style={{
                position: 'absolute',
                top: '42px',
                left: '50%',
                transform: 'translateX(-50%)',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                fontWeight: 'bold',
                color: '#ff3333',
                textShadow: '0 0 4px rgba(255,50,50,0.6)',
                letterSpacing: '0.05em',
              }}>
                {Math.round(t.distance)}m
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Click to deploy overlay */}

      {/* ═══ ENTER VEHICLE PROMPT (near crosshair) ═══ */}
      {state.locked && !hudOverlayOpen && !state.mountedVehicleName && state.nearVehicle && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div style={{
            marginTop: '80px',
            fontFamily: 'var(--font-pixel)',
            fontSize: '8px',
            letterSpacing: '0.1em',
            color: '#e8e8f0',
            background: 'rgba(12,16,24,0.85)',
            border: '2px solid #00e5ff',
            padding: '6px 14px',
          }}>
            <span style={{ color: '#00e5ff' }}>[F]</span> ENTER {(state.nearVehicleName ?? 'VEHICLE').toUpperCase()}
          </div>
        </div>
      )}

      {/* ═══ EJECT PROMPT + CONTROL HINTS (bottom-center) ═══ */}
      {state.locked && !hudOverlayOpen && state.mountedVehicleName && (
        <div className="absolute bottom-24 left-0 right-0 flex flex-col items-center pointer-events-none z-10" style={{ gap: '6px' }}>
          <div style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '6px',
            letterSpacing: '0.1em',
            color: '#6b7080',
            background: 'rgba(12,16,24,0.85)',
            border: '2px solid #1a1e2e',
            padding: '6px 12px',
            lineHeight: '2.2',
            textAlign: 'center',
          }}>
            {state.mountedVehicleName === 'Fighter Jet' ? (<>
              <div>
                <span style={{ color: '#e8e8f0' }}>W</span> THROTTLE UP
                {' '}<span style={{ color: '#e8e8f0' }}>S</span> THROTTLE DOWN
                {' '}<span style={{ color: '#e8e8f0' }}>A/D</span> YAW
              </div>
              <div>
                <span style={{ color: '#e8e8f0' }}>SPACE</span> PULL UP
                {' '}<span style={{ color: '#e8e8f0' }}>SHIFT</span> PUSH DOWN
                {' '}<span style={{ color: '#e8e8f0' }}>1/2</span> WEAPONS
              </div>
            </>) : (<>
              <div>
                <span style={{ color: '#e8e8f0' }}>W/S</span> FWD/BACK
                {' '}<span style={{ color: '#e8e8f0' }}>A/D</span> YAW
                {' '}<span style={{ color: '#e8e8f0' }}>Q/E</span> STRAFE
              </div>
              <div>
                <span style={{ color: '#e8e8f0' }}>SPACE</span> ASCEND
                {' '}<span style={{ color: '#e8e8f0' }}>SHIFT</span> DESCEND
                {' '}<span style={{ color: '#e8e8f0' }}>1/2</span> WEAPONS
              </div>
            </>)}
          </div>
          <div style={{
            fontFamily: 'var(--font-pixel)',
            fontSize: '8px',
            letterSpacing: '0.1em',
            color: '#e8e8f0',
            background: 'rgba(12,16,24,0.85)',
            border: '2px solid #00e5ff',
            padding: '5px 14px',
          }}>
            <span style={{ color: '#00e5ff' }}>[F]</span> EJECT
          </div>
        </div>
      )}

      {/* Click to deploy overlay */}
      {!state.locked && state.worldReady && !showSettings && !hudOverlayOpen && (
        <div
          className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer"
          onClick={() => canvasRef.current?.requestPointerLock()}
          style={{ background: 'rgba(10,12,20,0.8)' }}
        >
          <div className="text-center pointer-events-none">
            <div
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '16px',
                color: '#ff6b35',
                letterSpacing: '0.08em',
                marginBottom: '12px',
                textShadow: '3px 3px 0 #000',
              }}
            >
              CLICK TO DEPLOY
            </div>
            {/* Pixel divider */}
            <div style={{
              display: 'flex', gap: '3px', justifyContent: 'center',
              margin: '14px auto',
            }}>
              {['#ff6b35', '#ffd600', '#76ff03', '#00e5ff', '#7c4dff'].map((c, i) => (
                <div key={i} style={{ width: '12px', height: '3px', background: c, opacity: 0.5 }} />
              ))}
            </div>
            <div
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '6px',
                color: '#6b7080',
                letterSpacing: '0.1em',
                lineHeight: '2.6',
                animationDelay: '0.2s',
              }}
            >
              <div className="flex justify-center gap-8">
                <span><span style={{ color: '#e8e8f0' }}>WASD</span> MOVE</span>
                <span><span style={{ color: '#e8e8f0' }}>MOUSE</span> AIM</span>
                <span><span style={{ color: '#e8e8f0' }}>LMB</span> FIRE</span>
              </div>
              <div className="flex justify-center gap-8">
                <span><span style={{ color: '#e8e8f0' }}>SPACE</span> JUMP</span>
                <span><span style={{ color: '#e8e8f0' }}>R</span> RELOAD</span>
                <span><span style={{ color: '#e8e8f0' }}>1-3</span> WEAPONS</span>
              </div>
              <div className="flex justify-center gap-8">
                <span><span style={{ color: '#e8e8f0' }}>SHIFT</span> SPRINT</span>
                <span><span style={{ color: '#e8e8f0' }}>CTRL</span> CROUCH</span>
                <span><span style={{ color: '#e8e8f0' }}>F</span> VEHICLE</span>
                <span><span style={{ color: '#e8e8f0' }}>E</span> LOADOUT</span>
                <span><span style={{ color: '#e8e8f0' }}>T</span> CHAT</span>
                <span><span style={{ color: '#e8e8f0' }}>ESC</span> SETTINGS</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CHAT OVERLAY ═══ */}
        <ChatOverlay
          chatOpen={chatOpen}
          chatMessages={chatMessages}
          chatDraft={chatDraft}
          setChatDraft={setChatDraft}
          sendChatMessage={handleSendChatMessage}
          chatCooldownRemainingMs={chatCooldownRemainingMs}
          chatStatusText={chatStatusText}
          closeChat={closeChat}
        />

      {/* ═══ BOTTOM HUD ═══ */}
      <BottomHud
        health={state.health}
        weapon={state.weapon}
        ammo={state.ammo}
        maxAmmo={state.maxAmmo}
        isReloading={state.isReloading}
        kills={state.kills}
        deaths={state.deaths}
        loadout={state.loadout}
        heading={state.heading}
        mountedVehicleName={state.mountedVehicleName}
        vehicleHealth={state.vehicleHealth}
        vehicleMaxHealth={state.vehicleMaxHealth}
        vehicleWeapon={state.vehicleWeapon}
        vehicleAmmo={state.vehicleAmmo}
        vehicleReloading={state.vehicleReloading}
        vehicleAltitude={state.vehicleAltitude}
        vehicleMaxAmmo={state.vehicleMaxAmmo}
        vehicleSpeed={state.vehicleSpeed}
        vehicleThrottle={state.vehicleThrottle}
        vehicleWeaponSlots={state.vehicleWeaponSlots}
      />
    </div>
  );
}
