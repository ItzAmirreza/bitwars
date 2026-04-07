import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import { ChunkRenderer } from './ChunkMesher';

interface LiveBotState {
  pos: [number, number, number];
  vel: [number, number, number];
  target: [number, number, number];
  health: number;
  weapon: number;
  on_ground: boolean;
  action: number[];
}

const WEAPON_NAMES = ['Rifle', 'Shotgun', 'RPG', 'Machine Gun', 'Sniper'];
const ACTION_LABELS = ['Fwd', 'Strafe', 'Yaw', 'Pitch', 'Jump', 'Sprint', 'Fire', 'Weapon'];

const BOT_COLORS = [
  0x00ff88, 0x4488ff, 0xff4444, 0xffaa00,
  0xff44ff, 0x44ffff, 0xaaff44, 0xff8844,
  0x8844ff, 0x44ff88, 0xff4488, 0x88ff44,
  0x4444ff, 0xff8888, 0x88ffaa, 0xffff44,
  0xaa44ff, 0x44ffaa, 0xff44aa, 0xaaff88,
  0x4488aa, 0xaa8844, 0x44aa88, 0x88aa44,
  0xaa4488, 0x8844aa, 0x44aa44, 0xaa44aa,
  0x448844, 0x884444, 0x444488, 0x888844,
  0x00ff88, 0x4488ff, 0xff4444, 0xffaa00,
  0xff44ff, 0x44ffff, 0xaaff44, 0xff8844,
  0x8844ff, 0x44ff88, 0xff4488, 0x88ff44,
  0x4444ff, 0xff8888, 0x88ffaa, 0xffff44,
  0xaa44ff, 0x44ffaa, 0xff44aa, 0xaaff88,
  0x4488aa, 0xaa8844, 0x44aa88, 0x88aa44,
  0xaa4488, 0x8844aa, 0x44aa44, 0xaa44aa,
  0x448844, 0x884444, 0x444488, 0x888844,
];

export default function MapView3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedBot, setSelectedBot] = useState(0);
  const [followMode, setFollowMode] = useState<'follow' | 'free'>('follow');
  const [botCount, setBotCount] = useState(0);
  const [selectedBotState, setSelectedBotState] = useState<LiveBotState | null>(null);

  // Refs so the render loop can access latest React state without re-creating the effect
  const selectedBotRef = useRef(0);
  const followModeRef = useRef<'follow' | 'free'>('follow');
  selectedBotRef.current = selectedBot;
  followModeRef.current = followMode;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // ── Scene ──
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.004);

    const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    container.appendChild(renderer.domElement);

    // ── Lighting ──
    scene.add(new THREE.AmbientLight(0x667788, 0.7));
    const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
    sun.position.set(200, 300, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120;
    sun.shadow.camera.bottom = -120;
    scene.add(sun);

    // ── Bot Meshes ──
    const maxBots = 64;
    // Body
    const botBodyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.8, 1.7, 0.8),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      maxBots,
    );
    botBodyMesh.castShadow = true;
    botBodyMesh.count = 0;
    scene.add(botBodyMesh);

    // Head
    const botHeadMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.6),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      maxBots,
    );
    botHeadMesh.castShadow = true;
    botHeadMesh.count = 0;
    scene.add(botHeadMesh);

    // Beacon (visibility from far)
    const beaconMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 12, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
      maxBots,
    );
    beaconMesh.count = 0;
    scene.add(beaconMesh);

    // Selection ring (only for selected bot)
    const ringGeo = new THREE.RingGeometry(1.2, 1.5, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.visible = false;
    scene.add(selectionRing);

    // Look direction arrow (for selected bot)
    const arrowLen = 3;
    const arrowGeo = new THREE.BoxGeometry(0.08, 0.08, arrowLen);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const lookArrow = new THREE.Mesh(arrowGeo, arrowMat);
    lookArrow.visible = false;
    scene.add(lookArrow);

    // Targets
    const targetMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3, 0.3, 3),
      new THREE.MeshLambertMaterial({ color: 0xff2222, transparent: true, opacity: 0.5 }),
      maxBots,
    );
    targetMesh.count = 0;
    scene.add(targetMesh);

    // Target-to-bot dashed lines (only for selected bot)
    const targetLineMat = new THREE.LineDashedMaterial({ color: 0xff4444, dashSize: 1, gapSize: 0.5, transparent: true, opacity: 0.4 });
    const targetLineGeo = new THREE.BufferGeometry();
    const targetLine = new THREE.Line(targetLineGeo, targetLineMat);
    scene.add(targetLine);

    // Set instance colors
    for (let i = 0; i < maxBots; i++) {
      const c = new THREE.Color(BOT_COLORS[i % BOT_COLORS.length]);
      botBodyMesh.setColorAt(i, c);
      botHeadMesh.setColorAt(i, c);
      beaconMesh.setColorAt(i, c);
    }
    [botBodyMesh, botHeadMesh, beaconMesh].forEach(m => {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });

    // Trail for selected bot
    const trailPoints: THREE.Vector3[] = [];
    const trailMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5 });
    const trailLine = new THREE.Line(new THREE.BufferGeometry(), trailMat);
    trailLine.frustumCulled = false;
    scene.add(trailLine);

    // ── Terrain ──
    const chunkRenderer = new ChunkRenderer(scene, 5);
    let lastChunkUpdate = 0;

    // ── Camera ──
    let isDragging = false;
    let lastMX = 0, lastMY = 0;
    let azimuth = 0, elevation = Math.PI / 5, distance = 45;
    const focus = new THREE.Vector3(375, 10, 375);

    const keysDown = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => keysDown.add(e.code);
    const onKeyUp = (e: KeyboardEvent) => keysDown.delete(e.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onDown = (e: MouseEvent) => {
      if (e.target !== renderer.domElement) return;
      isDragging = true; lastMX = e.clientX; lastMY = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      azimuth += (e.clientX - lastMX) * 0.008;
      elevation = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, elevation + (e.clientY - lastMY) * 0.008));
      lastMX = e.clientX; lastMY = e.clientY;
    };
    const onUp = () => { isDragging = false; };
    const onWheel = (e: WheelEvent) => {
      if (e.target !== renderer.domElement) return;
      distance = Math.max(3, Math.min(300, distance + e.deltaY * 0.1));
      e.preventDefault();
    };

    renderer.domElement.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // ── Resize ──
    const handleResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);
    handleResize();

    // ── Render loop ──
    const tmpMat = new THREE.Matrix4();
    let animId = 0;
    let lastPoll = 0;
    let bots: LiveBotState[] = [];
    let prevTime = 0;
    let lastSelectedBot = -1;

    const animate = (time: number) => {
      animId = requestAnimationFrame(animate);
      const dt = Math.min((time - prevTime) / 1000, 0.1);
      prevTime = time;

      // Poll (5 Hz)
      if (time - lastPoll > 200) {
        lastPoll = time;
        invoke<LiveBotState[]>('get_live_bot_state')
          .then(s => { if (s?.length) { bots = s; setBotCount(s.length); } })
          .catch(() => {});
      }

      const sel = selectedBotRef.current;
      const n = bots.length;

      // Update instances
      botBodyMesh.count = n;
      botHeadMesh.count = n;
      beaconMesh.count = n;
      targetMesh.count = n;

      for (let i = 0; i < n; i++) {
        const b = bots[i];
        tmpMat.makeTranslation(b.pos[0], b.pos[1] - 0.85, b.pos[2]);
        botBodyMesh.setMatrixAt(i, tmpMat);
        tmpMat.makeTranslation(b.pos[0], b.pos[1] + 0.25, b.pos[2]);
        botHeadMesh.setMatrixAt(i, tmpMat);
        tmpMat.makeTranslation(b.pos[0], b.pos[1] + 6, b.pos[2]);
        beaconMesh.setMatrixAt(i, tmpMat);
        tmpMat.makeTranslation(b.target[0], b.target[1] - 1.5, b.target[2]);
        targetMesh.setMatrixAt(i, tmpMat);
      }
      botBodyMesh.instanceMatrix.needsUpdate = true;
      botHeadMesh.instanceMatrix.needsUpdate = true;
      beaconMesh.instanceMatrix.needsUpdate = true;
      targetMesh.instanceMatrix.needsUpdate = true;

      // Selected bot visuals
      if (sel < n) {
        const b = bots[sel];
        setSelectedBotState(b);

        // Selection ring at feet
        selectionRing.visible = true;
        selectionRing.position.set(b.pos[0], b.pos[1] - 1.7 + 0.05, b.pos[2]);
        ringMat.color.set(BOT_COLORS[sel % BOT_COLORS.length]);

        // Look direction arrow
        lookArrow.visible = true;
        const yaw = b.action[2] || 0;
        const pitch = b.action[3] || 0;
        const cosP = Math.cos(pitch * 0.5);
        const lx = -Math.sin(yaw * 0.3) * cosP;
        const ly = Math.sin(pitch * 0.5);
        const lz = -Math.cos(yaw * 0.3) * cosP;
        lookArrow.position.set(
          b.pos[0] + lx * arrowLen * 0.5,
          b.pos[1] + ly * arrowLen * 0.5,
          b.pos[2] + lz * arrowLen * 0.5,
        );
        lookArrow.lookAt(b.pos[0] + lx * 10, b.pos[1] + ly * 10, b.pos[2] + lz * 10);

        // Trail (clear on bot switch)
        if (sel !== lastSelectedBot) {
          trailPoints.length = 0;
          lastSelectedBot = sel;
          trailMat.color.set(BOT_COLORS[sel % BOT_COLORS.length]);
        }
        trailPoints.push(new THREE.Vector3(b.pos[0], b.pos[1] - 0.8, b.pos[2]));
        if (trailPoints.length > 500) trailPoints.shift();
        if (trailPoints.length > 1) {
          const geo = new THREE.BufferGeometry().setFromPoints(trailPoints);
          trailLine.geometry.dispose();
          trailLine.geometry = geo;
        }

        // Target line
        const tlPts = [
          new THREE.Vector3(b.pos[0], b.pos[1] - 0.5, b.pos[2]),
          new THREE.Vector3(b.target[0], b.target[1] - 1.0, b.target[2]),
        ];
        const tlGeo = new THREE.BufferGeometry().setFromPoints(tlPts);
        targetLine.geometry.dispose();
        targetLine.geometry = tlGeo;
        targetLine.computeLineDistances();
      } else {
        selectionRing.visible = false;
        lookArrow.visible = false;
      }

      // Camera
      if (followModeRef.current === 'follow' && sel < n) {
        const b = bots[sel];
        focus.lerp(new THREE.Vector3(b.pos[0], b.pos[1], b.pos[2]), 0.1);
      } else {
        const spd = 50 * dt;
        const fwd = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
        const right = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
        if (keysDown.has('KeyW')) focus.addScaledVector(fwd, spd);
        if (keysDown.has('KeyS')) focus.addScaledVector(fwd, -spd);
        if (keysDown.has('KeyA')) focus.addScaledVector(right, -spd);
        if (keysDown.has('KeyD')) focus.addScaledVector(right, spd);
        if (keysDown.has('Space')) focus.y += spd;
        if (keysDown.has('ShiftLeft')) focus.y -= spd;
        focus.x = Math.max(0, Math.min(750, focus.x));
        focus.y = Math.max(0, Math.min(100, focus.y));
        focus.z = Math.max(0, Math.min(750, focus.z));
      }

      camera.position.set(
        focus.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
        focus.y + Math.sin(elevation) * distance,
        focus.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
      );
      camera.lookAt(focus);
      sun.target.position.copy(focus);
      sun.position.set(focus.x + 60, 200, focus.z + 40);

      // Terrain streaming
      if (time - lastChunkUpdate > 1500) {
        lastChunkUpdate = time;
        chunkRenderer.update(focus.x, focus.z);
      }

      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      chunkRenderer.dispose();
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  // Notify backend which bot's terrain to show in preview
  useEffect(() => {
    invoke('set_preview_bot', { botIndex: selectedBot }).catch(() => {});
  }, [selectedBot]);

  const selectNextBot = useCallback(() => {
    setSelectedBot(s => (s + 1) % Math.max(1, botCount));
  }, [botCount]);
  const selectPrevBot = useCallback(() => {
    setSelectedBot(s => (s - 1 + Math.max(1, botCount)) % Math.max(1, botCount));
  }, [botCount]);

  const b = selectedBotState;
  const speed = b ? Math.sqrt(b.vel[0] ** 2 + b.vel[2] ** 2).toFixed(1) : '0';
  const botColor = `#${BOT_COLORS[selectedBot % BOT_COLORS.length].toString(16).padStart(6, '0')}`;

  return (
    <div style={{ background: '#0a0a0a', border: '3px solid #3a3a3a', position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Top-left: Bot selector */}
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={selectPrevBot} style={btnStyle}>&lt;</button>
          <div style={{
            background: 'rgba(0,0,0,0.8)', padding: '4px 10px',
            fontFamily: 'var(--font-pixel)', fontSize: 9, color: botColor,
            border: `2px solid ${botColor}`, minWidth: 100, textAlign: 'center',
          }}>
            BOT #{selectedBot}
          </div>
          <button onClick={selectNextBot} style={btnStyle}>&gt;</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#666', marginLeft: 4 }}>
            {botCount} total
          </span>
        </div>
      </div>

      {/* Top-right: Camera mode */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
        <button
          onClick={() => setFollowMode(followMode === 'follow' ? 'free' : 'follow')}
          style={{
            ...btnStyle,
            background: followMode === 'follow' ? '#00ff88' : '#2a2a2a',
            color: followMode === 'follow' ? '#0a0a0a' : '#888',
            borderColor: followMode === 'follow' ? '#00ff88' : '#3a3a3a',
          }}
        >
          {followMode === 'follow' ? 'FOLLOWING' : 'FREE CAM'}
        </button>
      </div>

      {/* Bottom-left: Selected bot info panel */}
      {b && (
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(0,0,0,0.85)', padding: 10,
          border: `2px solid ${botColor}`, minWidth: 280,
          fontFamily: 'var(--font-mono)', fontSize: 11, color: '#e0e0e0',
        }}>
          <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 8, color: botColor, marginBottom: 6 }}>
            BOT #{selectedBot} STATUS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px 12px' }}>
            <span style={{ color: '#888' }}>Pos</span>
            <span style={{ gridColumn: '2/4' }}>{b.pos[0].toFixed(0)}, {b.pos[1].toFixed(0)}, {b.pos[2].toFixed(0)}</span>
            <span style={{ color: '#888' }}>Speed</span>
            <span>{speed} u/s</span>
            <span style={{ color: b.on_ground ? '#00ff88' : '#ff8844' }}>{b.on_ground ? 'GROUND' : 'AIR'}</span>
            <span style={{ color: '#888' }}>Health</span>
            <span style={{ color: b.health > 75 ? '#00ff88' : b.health > 30 ? '#ffaa00' : '#ff4444' }}>
              {b.health.toFixed(0)}/{150}
            </span>
            <span />
            <span style={{ color: '#888' }}>Weapon</span>
            <span style={{ gridColumn: '2/4' }}>{WEAPON_NAMES[b.weapon] || `#${b.weapon}`}</span>
            <span style={{ color: '#888' }}>Target</span>
            <span style={{ gridColumn: '2/4' }}>{b.target[0].toFixed(0)}, {b.target[1].toFixed(0)}, {b.target[2].toFixed(0)}</span>
          </div>

          {/* Actions bar */}
          <div style={{ marginTop: 6, borderTop: '1px solid #333', paddingTop: 4 }}>
            <div style={{ fontFamily: 'var(--font-pixel)', fontSize: 7, color: '#888', marginBottom: 3 }}>ACTIONS</div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {b.action.map((val, i) => {
                const active = i >= 4 && i <= 7 ? val > 0.5 : Math.abs(val) > 0.1;
                const label = ACTION_LABELS[i];
                const isDiscrete = i >= 4 && i <= 7;
                return (
                  <div key={i} style={{
                    background: active ? (isDiscrete ? '#00ff8833' : '#4488ff22') : '#1a1a1a',
                    border: `1px solid ${active ? (isDiscrete ? '#00ff88' : '#4488ff') : '#333'}`,
                    padding: '1px 5px', fontSize: 9,
                    color: active ? '#fff' : '#555',
                  }}>
                    <span style={{ fontSize: 7, color: '#888' }}>{label} </span>
                    {isDiscrete ? (val > 0.5 ? 'ON' : 'off') : val.toFixed(1)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-right: Controls hint */}
      <div style={{
        position: 'absolute', bottom: 8, right: 8,
        fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.3)',
        textAlign: 'right',
      }}>
        {followMode === 'follow'
          ? '< > select bot | Drag orbit | Scroll zoom'
          : 'WASD move | Space/Shift up/down | Drag orbit | Scroll zoom'}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#888',
  border: '2px solid #3a3a3a',
  padding: '4px 10px',
  fontFamily: 'var(--font-pixel)',
  fontSize: 9,
  cursor: 'pointer',
};
