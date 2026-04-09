import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LiveBotState } from './PreviewPage';

const WEAPON_NAMES = ['Rifle', 'Shotgun', 'RPG'];
const ACTION_LABELS = ['Fwd', 'Strafe', 'Yaw', 'Pitch', 'Jump', 'Sprint', 'Fire', 'Weapon'];
const PREVIEW_RENDER_TAG = 'preview-r7-iso';
const CHUNK_SIZE = 16;
const TERRAIN_RADIUS = 3;
const ISO_X = 0.92;
const ISO_Y = 0.48;
const HEIGHT_SCALE = 0.82;

const BOT_COLORS = [
  '#00ff88', '#4488ff', '#ff4444', '#ffaa00',
  '#ff44ff', '#44ffff', '#aaff44', '#ff8844',
  '#8844ff', '#44ff88', '#ff4488', '#88ff44',
  '#4444ff', '#ff8888', '#88ffaa', '#ffff44',
  '#aa44ff', '#44ffaa', '#ff44aa', '#aaff88',
  '#4488aa', '#aa8844', '#44aa88', '#88aa44',
  '#aa4488', '#8844aa', '#44aa44', '#aa44aa',
  '#448844', '#884444', '#444488', '#888844',
];

const BLOCK_COLORS: Record<number, [number, number, number]> = {
  1: [135, 135, 135],
  2: [102, 102, 102],
  3: [69, 69, 69],
  4: [153, 84, 51],
  5: [171, 102, 69],
  6: [120, 153, 171],
  7: [120, 102, 84],
  8: [135, 102, 69],
  9: [204, 186, 135],
  10: [84, 135, 51],
  11: [153, 120, 69],
  12: [153, 153, 153],
  13: [222, 222, 237],
  14: [255, 204, 69],
  15: [51, 51, 51],
};

type Props = {
  bots: LiveBotState[];
  selectedBot: number;
  onSelectBot: (index: number) => void;
  followMode: 'follow' | 'free';
  onToggleFollow: () => void;
  selectedBotState: LiveBotState | null;
  terrainRevision: number;
  frameId: number;
};

type TerrainColumn = {
  x: number;
  z: number;
  height: number;
  block: number;
};

type TerrainSnapshot = {
  columns: TerrainColumn[];
  lookup: Map<string, TerrainColumn>;
  chunkCount: number;
};

type ViewCenter = {
  x: number;
  y: number;
  z: number;
};

export default function MapView3D({
  bots,
  selectedBot,
  onSelectBot,
  followMode,
  onToggleFollow,
  selectedBotState,
  terrainRevision,
  frameId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderStats, setRenderStats] = useState({
    frames: 0,
    chunks: 0,
    columns: 0,
    bots: 0,
    camera: 'n/a',
    mode: 'follow',
  });

  const botsRef = useRef(bots);
  const selectedBotRef = useRef(selectedBot);
  const followModeRef = useRef(followMode);
  const terrainRevisionRef = useRef(terrainRevision);
  const frameIdRef = useRef(frameId);
  const selectedBotStateRef = useRef(selectedBotState);
  const terrainRef = useRef<TerrainSnapshot>({ columns: [], lookup: new Map(), chunkCount: 0 });
  const viewCenterRef = useRef<ViewCenter>({ x: 375, y: 18, z: 375 });
  const zoomRef = useRef(1.3);
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const trailRef = useRef<Array<[number, number, number]>>([]);
  const lastTrailFrameRef = useRef(-1);
  const lastSelectedRef = useRef(-1);

  botsRef.current = bots;
  selectedBotRef.current = selectedBot;
  followModeRef.current = followMode;
  terrainRevisionRef.current = terrainRevision;
  frameIdRef.current = frameId;
  selectedBotStateRef.current = selectedBotState;

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setRenderError('2d-context-unavailable');
      return;
    }

    let animId = 0;
    let frameCounter = 0;
    let lastTime = 0;
    let lastTerrainFetch = -Infinity;
    let lastTerrainRevision = -1;
    let lastFocusChunk = '';
    let fetchInFlight = false;
    let lastDebugPush = 0;

    const resizeCanvas = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
    };

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);
    resizeCanvas();

    const fetchTerrain = async (centerX: number, centerZ: number) => {
      if (fetchInFlight) return;
      fetchInFlight = true;
      try {
        const tuples = await invoke<[number, number, number, number[]][]>(
          'get_terrain_chunks',
          { centerX, centerZ, radius: TERRAIN_RADIUS },
        );
        terrainRef.current = buildTerrainSnapshot(tuples);
        if (renderError) {
          setRenderError(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRenderError(message || 'terrain-fetch-failed');
      } finally {
        fetchInFlight = false;
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.target !== canvas) return;
      dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!dragRef.current.active || followModeRef.current !== 'free') return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      dragRef.current.x = event.clientX;
      dragRef.current.y = event.clientY;

      const zoom = zoomRef.current;
      const cellScale = 14 * zoom;
      const worldDx = dx / (2 * ISO_X * cellScale) + dy / (2 * ISO_Y * cellScale);
      const worldDz = -dx / (2 * ISO_X * cellScale) + dy / (2 * ISO_Y * cellScale);
      viewCenterRef.current.x = clamp(viewCenterRef.current.x - worldDx, 0, 750);
      viewCenterRef.current.z = clamp(viewCenterRef.current.z - worldDz, 0, 750);
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.target !== canvas) return;
      zoomRef.current = clamp(zoomRef.current * Math.exp(-event.deltaY * 0.0012), 0.65, 3.2);
      event.preventDefault();
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const draw = (time: number) => {
      animId = requestAnimationFrame(draw);
      const dt = Math.min((time - lastTime) / 1000 || 0.016, 0.05);
      lastTime = time;
      frameCounter += 1;

      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;

      const currentBots = botsRef.current;
      const selected = selectedBotRef.current;
      const selectedSource =
        selected >= 0 && selected < currentBots.length ? currentBots[selected] : selectedBotStateRef.current;
      const zoom = zoomRef.current;

      if (selectedSource) {
        const view = viewCenterRef.current;
        if (followModeRef.current === 'follow') {
          const alpha = 1 - Math.exp(-dt * 8);
          view.x = lerp(view.x, selectedSource.pos[0], alpha);
          view.y = lerp(view.y, selectedSource.pos[1] + 10, alpha);
          view.z = lerp(view.z, selectedSource.pos[2], alpha);
        }

        if (selected !== lastSelectedRef.current) {
          trailRef.current = [];
          lastSelectedRef.current = selected;
          lastTrailFrameRef.current = -1;
        }
        if (frameIdRef.current !== lastTrailFrameRef.current) {
          lastTrailFrameRef.current = frameIdRef.current;
          trailRef.current.push([selectedSource.pos[0], selectedSource.pos[1], selectedSource.pos[2]]);
          if (trailRef.current.length > 80) {
            trailRef.current.shift();
          }
        }
      }

      const focus = viewCenterRef.current;
      const currentChunk = `${Math.floor(focus.x / CHUNK_SIZE)}_${Math.floor(focus.z / CHUNK_SIZE)}`;
      const terrainMissing = terrainRef.current.columns.length === 0;
      if (
        time - lastTerrainFetch > (terrainMissing ? 80 : 180) &&
        (terrainRevisionRef.current !== lastTerrainRevision || currentChunk !== lastFocusChunk)
      ) {
        lastTerrainFetch = time;
        lastTerrainRevision = terrainRevisionRef.current;
        lastFocusChunk = currentChunk;
        fetchTerrain(focus.x, focus.z).catch(() => {});
      }

      try {
        renderScene(ctx, width, height, focus, zoom, terrainRef.current, currentBots, selected, trailRef.current);

        if (time - lastDebugPush > 400) {
          lastDebugPush = time;
          setRenderStats({
            frames: frameCounter,
            chunks: terrainRef.current.chunkCount,
            columns: terrainRef.current.columns.length,
            bots: currentBots.length,
            camera: `${focus.x.toFixed(1)},${focus.y.toFixed(1)},${focus.z.toFixed(1)} z${zoom.toFixed(2)}`,
            mode: followModeRef.current,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRenderError(message || 'render-failed');
      }
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [renderError]);

  const selectNextBot = useCallback(() => {
    onSelectBot((selectedBot + 1) % Math.max(1, bots.length));
  }, [bots.length, onSelectBot, selectedBot]);

  const selectPrevBot = useCallback(() => {
    onSelectBot((selectedBot - 1 + Math.max(1, bots.length)) % Math.max(1, bots.length));
  }, [bots.length, onSelectBot, selectedBot]);

  const speed = useMemo(() => {
    if (!selectedBotState) return '0';
    return Math.sqrt(selectedBotState.vel[0] ** 2 + selectedBotState.vel[2] ** 2).toFixed(1);
  }, [selectedBotState]);

  const botColor = BOT_COLORS[selectedBot % BOT_COLORS.length];
  const bot = selectedBotState;

  return (
    <div style={{ background: '#101418', border: '3px solid #3a3a3a', position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>

      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={selectPrevBot} style={btnStyle}>&lt;</button>
          <div style={{
            background: 'rgba(7,10,14,0.82)',
            padding: '4px 10px',
            fontFamily: 'var(--font-pixel)',
            fontSize: 9,
            color: botColor,
            border: `2px solid ${botColor}`,
            minWidth: 100,
            textAlign: 'center',
          }}>
            BOT #{selectedBot}
          </div>
          <button onClick={selectNextBot} style={btnStyle}>&gt;</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#7a8a97', marginLeft: 4 }}>
            {bots.length} total
          </span>
        </div>
      </div>

      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
        <button
          onClick={onToggleFollow}
          style={{
            ...btnStyle,
            background: followMode === 'follow' ? '#00ff88' : '#2a2a2a',
            color: followMode === 'follow' ? '#0a0a0a' : '#9eaab4',
            borderColor: followMode === 'follow' ? '#00ff88' : '#3a3a3a',
          }}
        >
          {followMode === 'follow' ? 'FOLLOWING' : 'FREE CAM'}
        </button>
      </div>

      {bot && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          background: 'rgba(7,10,14,0.86)',
          padding: 10,
          border: `2px solid ${botColor}`,
          minWidth: 320,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#dbe3e8',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: botColor, marginBottom: 6 }}>
            LIVE BOT PREVIEW | {PREVIEW_RENDER_TAG}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px 12px' }}>
            <span style={{ color: '#82939f' }}>Pos</span>
            <span style={{ gridColumn: '2 / 4' }}>{bot.pos[0].toFixed(1)}, {bot.pos[1].toFixed(1)}, {bot.pos[2].toFixed(1)}</span>
            <span style={{ color: '#82939f' }}>Speed</span>
            <span>{speed} u/s</span>
            <span style={{ color: bot.on_ground ? '#00ff88' : '#ffae57' }}>{bot.on_ground ? 'GROUND' : 'AIR'}</span>
            <span style={{ color: '#82939f' }}>Look</span>
            <span>{(bot.yaw * 57.3).toFixed(0)}°</span>
            <span>{(bot.pitch * 57.3).toFixed(0)}° pitch</span>
            <span style={{ color: '#82939f' }}>Health</span>
            <span style={{ color: bot.health > 75 ? '#00ff88' : bot.health > 30 ? '#ffaa00' : '#ff4444' }}>
              {bot.health.toFixed(0)}/150
            </span>
            <span />
            <span style={{ color: '#82939f' }}>Weapon</span>
            <span style={{ gridColumn: '2 / 4' }}>{WEAPON_NAMES[bot.weapon] || `#${bot.weapon}`}</span>
            <span style={{ color: '#82939f' }}>Target</span>
            <span style={{ gridColumn: '2 / 4' }}>{bot.target[0].toFixed(1)}, {bot.target[1].toFixed(1)}, {bot.target[2].toFixed(1)}</span>
            <span style={{ color: '#82939f' }}>Render</span>
            <span style={{ gridColumn: '2 / 4', color: renderError ? '#ff7b7b' : '#c7d2d9' }}>
              {renderStats.mode} f:{renderStats.frames} b:{renderStats.bots} c:{renderStats.chunks} cols:{renderStats.columns}{renderError ? ` err:${renderError}` : ''}
            </span>
            <span style={{ color: '#82939f' }}>Camera</span>
            <span style={{ gridColumn: '2 / 4', color: '#c7d2d9' }}>
              {renderStats.camera}
            </span>
          </div>

          <div style={{ marginTop: 8, borderTop: '1px solid #27323a', paddingTop: 5 }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: '#82939f', marginBottom: 4 }}>ACTIONS</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {bot.action.map((value, index) => {
                const discrete = index >= 4 && index <= 7;
                const active = discrete ? value > 0.5 : Math.abs(value) > 0.08;
                return (
                  <div
                    key={index}
                    style={{
                      background: active ? (discrete ? '#00ff8830' : '#4aa6ff22') : '#141b21',
                      border: `1px solid ${active ? (discrete ? '#00ff88' : '#4aa6ff') : '#263038'}`,
                      color: active ? '#f4fbff' : '#6d7b86',
                      padding: '2px 6px',
                      fontSize: 9,
                    }}
                  >
                    <span style={{ fontSize: 7, color: '#8fa0ac' }}>{ACTION_LABELS[index]} </span>
                    {discrete ? (value > 0.5 ? 'ON' : 'off') : value.toFixed(2)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'rgba(240,247,251,0.38)',
        textAlign: 'right',
        background: 'rgba(7,10,14,0.52)',
        padding: '4px 8px',
      }}>
        {followMode === 'follow'
          ? 'isometric live view | wheel zoom | switch to free for drag pan'
          : 'drag pan | wheel zoom'}
      </div>
    </div>
  );
}

function buildTerrainSnapshot(tuples: [number, number, number, number[]][]): TerrainSnapshot {
  const lookup = new Map<string, TerrainColumn>();

  for (const [cx, cy, cz, blockData] of tuples) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const block = blockData[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] ?? 0;
          if (block === 0) continue;
          const x = cx * CHUNK_SIZE + lx;
          const y = cy * CHUNK_SIZE + ly;
          const z = cz * CHUNK_SIZE + lz;
          const key = `${x}_${z}`;
          const existing = lookup.get(key);
          if (!existing || y > existing.height) {
            lookup.set(key, { x, z, height: y, block });
          }
        }
      }
    }
  }

  const columns = Array.from(lookup.values()).sort((a, b) => {
    const depthA = a.x + a.z + a.height * 0.2;
    const depthB = b.x + b.z + b.height * 0.2;
    return depthA - depthB || a.x - b.x || a.z - b.z;
  });

  return {
    columns,
    lookup,
    chunkCount: tuples.length,
  };
}

function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: ViewCenter,
  zoom: number,
  terrain: TerrainSnapshot,
  bots: LiveBotState[],
  selectedBot: number,
  trail: Array<[number, number, number]>,
) {
  ctx.clearRect(0, 0, width, height);

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#86b7d5');
  sky.addColorStop(0.62, '#9dc4dd');
  sky.addColorStop(1, '#bfd8e6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const groundFade = ctx.createLinearGradient(0, height * 0.46, 0, height);
  groundFade.addColorStop(0, 'rgba(14,24,29,0)');
  groundFade.addColorStop(1, 'rgba(10,18,23,0.25)');
  ctx.fillStyle = groundFade;
  ctx.fillRect(0, height * 0.46, width, height * 0.54);

  drawIsoGrid(ctx, width, height, center, zoom);
  drawTerrain(ctx, width, height, center, zoom, terrain);
  drawTrail(ctx, width, height, center, zoom, trail);
  drawBots(ctx, width, height, center, zoom, bots, selectedBot);
}

function drawIsoGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: ViewCenter,
  zoom: number,
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(38,57,69,0.45)';
  ctx.lineWidth = 1;

  const spacing = 25;
  const extent = 175;
  for (let world = -extent; world <= extent; world += spacing) {
    const a = projectPoint(center.x - extent, 0, center.z + world, center, zoom, width, height);
    const b = projectPoint(center.x + extent, 0, center.z + world, center, zoom, width, height);
    const c = projectPoint(center.x + world, 0, center.z - extent, center, zoom, width, height);
    const d = projectPoint(center.x + world, 0, center.z + extent, center, zoom, width, height);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTerrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: ViewCenter,
  zoom: number,
  terrain: TerrainSnapshot,
) {
  const lookup = terrain.lookup;
  for (const column of terrain.columns) {
    const top = column.height + 1;
    const northHeight = lookup.get(`${column.x}_${column.z + 1}`)?.height ?? -1;
    const eastHeight = lookup.get(`${column.x + 1}_${column.z}`)?.height ?? -1;

    const p0 = projectPoint(column.x, top, column.z, center, zoom, width, height);
    const p1 = projectPoint(column.x + 1, top, column.z, center, zoom, width, height);
    const p2 = projectPoint(column.x + 1, top, column.z + 1, center, zoom, width, height);
    const p3 = projectPoint(column.x, top, column.z + 1, center, zoom, width, height);

    if (Math.max(p0.x, p1.x, p2.x, p3.x) < -80 || Math.min(p0.x, p1.x, p2.x, p3.x) > width + 80) continue;
    if (Math.max(p0.y, p1.y, p2.y, p3.y) < -120 || Math.min(p0.y, p1.y, p2.y, p3.y) > height + 120) continue;

    const base = BLOCK_COLORS[column.block] ?? [128, 128, 128];

    if (eastHeight < column.height) {
      const bottomA = projectPoint(column.x + 1, eastHeight + 1, column.z, center, zoom, width, height);
      const bottomB = projectPoint(column.x + 1, eastHeight + 1, column.z + 1, center, zoom, width, height);
      fillPolygon(ctx, [p1, p2, bottomB, bottomA], shade(base, 0.66));
    }

    if (northHeight < column.height) {
      const bottomA = projectPoint(column.x, northHeight + 1, column.z + 1, center, zoom, width, height);
      const bottomB = projectPoint(column.x + 1, northHeight + 1, column.z + 1, center, zoom, width, height);
      fillPolygon(ctx, [p3, p2, bottomB, bottomA], shade(base, 0.82));
    }

    fillPolygon(ctx, [p0, p1, p2, p3], shade(base, 1.06));
    strokePolygon(ctx, [p0, p1, p2, p3], 'rgba(10,16,20,0.18)');
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: ViewCenter,
  zoom: number,
  trail: Array<[number, number, number]>,
) {
  if (trail.length < 2) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,136,0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  trail.forEach((point, index) => {
    const p = projectPoint(point[0], point[1], point[2], center, zoom, width, height);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawBots(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: ViewCenter,
  zoom: number,
  bots: LiveBotState[],
  selectedBot: number,
) {
  const ordered = bots
    .map((bot, index) => ({ bot, index }))
    .sort((a, b) => {
      const depthA = a.bot.pos[0] + a.bot.pos[2] + a.bot.pos[1] * 0.25;
      const depthB = b.bot.pos[0] + b.bot.pos[2] + b.bot.pos[1] * 0.25;
      return depthA - depthB;
    });

  for (const { bot, index } of ordered) {
    const selected = index === selectedBot;
    const color = BOT_COLORS[index % BOT_COLORS.length];
    const foot = projectPoint(bot.pos[0], bot.pos[1] - 1.55, bot.pos[2], center, zoom, width, height);
    const body = projectPoint(bot.pos[0], bot.pos[1] + 0.1, bot.pos[2], center, zoom, width, height);
    const head = projectPoint(bot.pos[0], bot.pos[1] + 1.4, bot.pos[2], center, zoom, width, height);
    const target = projectPoint(bot.target[0], bot.target[1], bot.target[2], center, zoom, width, height);
    const look = projectPoint(
      bot.pos[0] - Math.sin(bot.yaw) * 2.1,
      bot.pos[1] + 0.6 - Math.sin(bot.pitch) * 0.9,
      bot.pos[2] - Math.cos(bot.yaw) * 2.1,
      center,
      zoom,
      width,
      height,
    );

    ctx.save();

    ctx.strokeStyle = selected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();

    ctx.strokeStyle = '#fff4a3';
    ctx.lineWidth = selected ? 2.6 : 1.5;
    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(look.x, look.y);
    ctx.stroke();

    ctx.fillStyle = selected ? 'rgba(255,140,66,0.28)' : 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y + 3, selected ? 13 : 8, selected ? 7 : 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = selected ? '#ffffff' : color;
    ctx.lineWidth = selected ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(body.x, body.y);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(head.x, head.y, selected ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f0f4ff';
    ctx.beginPath();
    ctx.arc(look.x, look.y, selected ? 3.2 : 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (selected) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(foot.x, foot.y + 2, 15, 8, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,91,82,0.45)';
      ctx.beginPath();
      ctx.arc(target.x, target.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function projectPoint(
  x: number,
  y: number,
  z: number,
  center: ViewCenter,
  zoom: number,
  width: number,
  height: number,
) {
  const cellScale = 14 * zoom;
  const dx = x - center.x;
  const dy = y - center.y;
  const dz = z - center.z;
  return {
    x: width * 0.5 + (dx - dz) * ISO_X * cellScale,
    y: height * 0.56 + (dx + dz) * ISO_Y * cellScale - dy * HEIGHT_SCALE * cellScale,
  };
}

function fillPolygon(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  fill: string,
) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokePolygon(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  stroke: string,
) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function shade(color: [number, number, number], multiplier: number): string {
  return `rgb(${Math.round(clamp(color[0] * multiplier, 0, 255))}, ${Math.round(clamp(color[1] * multiplier, 0, 255))}, ${Math.round(clamp(color[2] * multiplier, 0, 255))})`;
}

function lerp(from: number, to: number, alpha: number) {
  return from + (to - from) * alpha;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const btnStyle: React.CSSProperties = {
  background: '#20282e',
  color: '#9eaab4',
  border: '2px solid #344048',
  padding: '4px 10px',
  fontFamily: 'var(--font-pixel)',
  fontSize: 9,
  cursor: 'pointer',
};
