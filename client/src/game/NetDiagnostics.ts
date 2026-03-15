/**
 * NetDiagnostics.ts — Dev-only networking & movement diagnostics.
 *
 * F3  — start/stop recording + show/hide overlay
 * F4  — download captured session as a .log file
 *
 * Only exists when `import.meta.env.DEV` is true (bun dev).
 * Zero cost when F3 is closed: every recording method early-returns.
 */

// ── Rolling sample buffer ──
class RingSampler {
  private buf: number[];
  private idx = 0;
  private count = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity).fill(0);
  }

  push(v: number): void {
    this.buf[this.idx] = v;
    this.idx = (this.idx + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  avg(): number {
    if (this.count === 0) return 0;
    let s = 0;
    for (let i = 0; i < this.count; i++) s += this.buf[i]!;
    return s / this.count;
  }

  min(): number {
    if (this.count === 0) return 0;
    let m = Infinity;
    for (let i = 0; i < this.count; i++) if (this.buf[i]! < m) m = this.buf[i]!;
    return m;
  }

  max(): number {
    if (this.count === 0) return 0;
    let m = -Infinity;
    for (let i = 0; i < this.count; i++) if (this.buf[i]! > m) m = this.buf[i]!;
    return m;
  }

  size(): number { return this.count; }
}

// ── Rate counter (events per second) ──
class RateCounter {
  private timestamps: number[] = [];

  tick(): void {
    this.timestamps.push(performance.now());
  }

  hz(): number {
    const now = performance.now();
    const cutoff = now - 1000;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }
}

export interface SentSnapshot {
  pos: { x: number; y: number; z: number };
  time: number;
}

export class NetDiagnostics {
  // ── Public ──
  visible = false;

  // ── Internals ──
  private overlay: HTMLDivElement | null = null;
  private isDev: boolean;

  // Samplers (only filled while visible)
  private rtt = new RingSampler(60);
  private echoDist = new RingSampler(60);
  private correctionDist = new RingSampler(60);
  private correctionCount = 0;
  private sentDelta = new RingSampler(60);
  private lastSentPos = { x: 0, y: 0, z: 0 };
  private sendRate = new RateCounter();
  private recvRate = new RateCounter();
  private speed = new RingSampler(30);
  private frameDelta = new RingSampler(120);
  private vehicleErr = new RingSampler(60);
  private vehicleServerRate = new RateCounter();
  private vehicleSnapJump = new RingSampler(60);  // position jump when new server snapshot arrives
  private vehicleSpeed = new RingSampler(60);
  private vehicleInputRate = new RateCounter();
  private vehicleStaleness = new RingSampler(60); // ms since last server update at render time
  teleportCount = 0;

  private sentHistory: SentSnapshot[] = [];
  private readonly SENT_HISTORY_MAX = 10;

  // Persistent log (only appended while visible)
  private sessionLog: string[] = [];
  private lastSnapshotAt = 0;
  private readonly SNAPSHOT_INTERVAL_MS = 2000;
  private recentLines: string[] = [];
  private readonly MAX_RECENT = 12;
  private lastClientPos = { x: 0, y: 0, z: 0 };
  private recordingStartedAt = '';

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault();
      this.visible = !this.visible;
      if (this.overlay) this.overlay.style.display = this.visible ? 'block' : 'none';
      if (this.visible) {
        this.recordingStartedAt = new Date().toISOString();
        this.appendLog(`RECORDING START ${this.recordingStartedAt}`);
      } else {
        this.appendLog(`RECORDING STOP`);
      }
    }
    if (e.code === 'F4') {
      e.preventDefault();
      this.downloadLog();
    }
  };

  constructor() {
    this.isDev = typeof import.meta !== 'undefined'
      && typeof (import.meta as any).env !== 'undefined'
      && !!(import.meta as any).env.DEV;

    if (!this.isDev) return;

    window.addEventListener('keydown', this.handleKeyDown);

    this.createOverlay();
  }

  // ══════════════════════════════════════════════════════════════
  //  RECORDING  — all no-ops when overlay is closed
  // ══════════════════════════════════════════════════════════════

  recordFrame(delta: number): void {
    if (!this.visible) return;
    this.frameDelta.push(delta * 1000);
  }

  recordPositionSent(pos: { x: number; y: number; z: number }): void {
    if (!this.visible) return;
    const now = performance.now();

    const dx = pos.x - this.lastSentPos.x;
    const dy = pos.y - this.lastSentPos.y;
    const dz = pos.z - this.lastSentPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.sentDelta.push(dist);

    if (dist > 10) {
      this.appendLog(`LARGE_SENT_DELTA: ${dist.toFixed(2)}u  pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
    }

    this.lastSentPos = { x: pos.x, y: pos.y, z: pos.z };
    this.lastClientPos = { x: pos.x, y: pos.y, z: pos.z };
    this.sendRate.tick();

    this.sentHistory.push({ pos: { ...this.lastSentPos }, time: now });
    if (this.sentHistory.length > this.SENT_HISTORY_MAX) this.sentHistory.shift();
  }

  recordServerEcho(
    serverPos: { x: number; y: number; z: number },
    clientPos: { x: number; y: number; z: number },
  ): void {
    if (!this.visible) return;
    const now = performance.now();
    this.recvRate.tick();
    this.lastClientPos = { x: clientPos.x, y: clientPos.y, z: clientPos.z };

    const dx = serverPos.x - clientPos.x;
    const dy = serverPos.y - clientPos.y;
    const dz = serverPos.z - clientPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.echoDist.push(dist);

    // RTT: match echo to a sent position
    let bestRtt = -1;
    let bestIdx = -1;
    let bestCorrDist = 0;
    for (let i = this.sentHistory.length - 1; i >= 0; i--) {
      const sent = this.sentHistory[i]!;
      const sdx = serverPos.x - sent.pos.x;
      const sdy = serverPos.y - sent.pos.y;
      const sdz = serverPos.z - sent.pos.z;
      const sDist = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
      if (sDist < 2.0) {
        bestRtt = now - sent.time;
        bestIdx = i;
        bestCorrDist = sDist;
        break;
      }
    }

    if (bestRtt >= 0 && bestIdx >= 0) {
      this.rtt.push(bestRtt);
      this.sentHistory.splice(0, bestIdx + 1);

      if (bestCorrDist > 0.1) {
        this.correctionDist.push(bestCorrDist);
        this.correctionCount++;
        this.appendLog(
          `SERVER_CORRECTION: ${bestCorrDist.toFixed(3)}u  `
          + `srv=(${serverPos.x.toFixed(1)},${serverPos.y.toFixed(1)},${serverPos.z.toFixed(1)})  `
          + `cli=(${clientPos.x.toFixed(1)},${clientPos.y.toFixed(1)},${clientPos.z.toFixed(1)})`,
        );
      }
    }

    if (dist > 5) {
      this.appendLog(
        `LARGE_ECHO: ${dist.toFixed(2)}u  `
        + `srv=(${serverPos.x.toFixed(1)},${serverPos.y.toFixed(1)},${serverPos.z.toFixed(1)})  `
        + `cli=(${clientPos.x.toFixed(1)},${clientPos.y.toFixed(1)},${clientPos.z.toFixed(1)})`,
      );
    }
  }

  recordTeleport(
    serverPos: { x: number; y: number; z: number },
    clientPos: { x: number; y: number; z: number },
  ): void {
    if (!this.visible) return;
    this.teleportCount++;
    const dx = serverPos.x - clientPos.x;
    const dy = serverPos.y - clientPos.y;
    const dz = serverPos.z - clientPos.z;
    this.appendLog(
      `TELEPORT: ${Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(1)}u  `
      + `srv=(${serverPos.x.toFixed(1)},${serverPos.y.toFixed(1)},${serverPos.z.toFixed(1)})  `
      + `cli=(${clientPos.x.toFixed(1)},${clientPos.y.toFixed(1)},${clientPos.z.toFixed(1)})`,
    );
  }

  recordSpeed(unitsPerSec: number): void {
    if (!this.visible) return;
    this.speed.push(unitsPerSec);
  }

  recordVehiclePredError(error: number): void {
    if (!this.visible) return;
    this.vehicleErr.push(error);
  }

  /** Called when a new server entity snapshot arrives for the local pilot's vehicle. */
  recordVehicleServerUpdate(
    newPos: { x: number; y: number; z: number },
    newVel: { x: number; y: number; z: number },
    smoothedPos: { x: number; y: number; z: number },
  ): void {
    if (!this.visible) return;
    this.vehicleServerRate.tick();

    // Jump: how far the new server pos is from where the smoothed display was
    const dx = newPos.x - smoothedPos.x;
    const dy = newPos.y - smoothedPos.y;
    const dz = newPos.z - smoothedPos.z;
    const jump = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.vehicleSnapJump.push(jump);

    const spd = Math.sqrt(newVel.x * newVel.x + newVel.y * newVel.y + newVel.z * newVel.z);
    this.vehicleSpeed.push(spd);

    if (jump > 3) {
      this.appendLog(
        `VEH_SNAP_JUMP: ${jump.toFixed(2)}u  `
        + `srv=(${newPos.x.toFixed(1)},${newPos.y.toFixed(1)},${newPos.z.toFixed(1)})  `
        + `disp=(${smoothedPos.x.toFixed(1)},${smoothedPos.y.toFixed(1)},${smoothedPos.z.toFixed(1)})  `
        + `vel=${spd.toFixed(1)}`,
      );
    }
  }

  /** Called when vehicle input is sent to the server. */
  recordVehicleInputSent(): void {
    if (!this.visible) return;
    this.vehicleInputRate.tick();
  }

  /** Called each frame with ms since last vehicle server update. */
  recordVehicleStaleness(ms: number): void {
    if (!this.visible) return;
    this.vehicleStaleness.push(ms);
  }

  /** Track mountedVehicleId per-frame to detect toggling. */
  private lastMountIdLogAt = 0;
  private lastMountIdValue = 0;
  private mountIdZeroFrames = 0;
  private mountIdNonZeroFrames = 0;
  recordMountedId(id: number): void {
    if (!this.visible) return;
    // Log whenever the value changes, or every 2s as a heartbeat
    const now = performance.now();
    if (id !== this.lastMountIdValue || now - this.lastMountIdLogAt > 2000) {
      this.appendLog(
        `MOUNT_ID: ${id} (was ${this.lastMountIdValue}) zero=${this.mountIdZeroFrames} nonzero=${this.mountIdNonZeroFrames}`,
      );
      this.lastMountIdValue = id;
      this.lastMountIdLogAt = now;
      this.mountIdZeroFrames = 0;
      this.mountIdNonZeroFrames = 0;
    }
    if (id === 0) this.mountIdZeroFrames++;
    else this.mountIdNonZeroFrames++;
  }

  /** Log mounted camera pipeline state every ~2s to diagnose frozen camera. */
  private lastMountDiagAt = 0;
  recordMountedCameraState(info: {
    mountedId: number;
    hasMesh: boolean;
    hasEntityRow: boolean;
    poseResult: 'mesh' | 'entity' | 'null';
    meshPos: { x: number; y: number; z: number } | null;
    cameraPos: { x: number; y: number; z: number };
    vehicleCount: number;
    localServerTime: number;
  }): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.lastMountDiagAt < 2000) return;
    this.lastMountDiagAt = now;
    const m = info.meshPos;
    this.appendLog(
      `MOUNT_STATE: id=${info.mountedId} mesh=${info.hasMesh} entity=${info.hasEntityRow} `
      + `pose=${info.poseResult} vehCount=${info.vehicleCount} srvTime=${info.localServerTime.toFixed(0)} `
      + `meshPos=${m ? `(${m.x.toFixed(1)},${m.y.toFixed(1)},${m.z.toFixed(1)})` : 'none'} `
      + `camPos=(${info.cameraPos.x.toFixed(1)},${info.cameraPos.y.toFixed(1)},${info.cameraPos.z.toFixed(1)})`,
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  OVERLAY  — called every frame, short-circuits when closed
  // ══════════════════════════════════════════════════════════════

  refreshOverlay(): void {
    if (!this.visible || !this.overlay) return;

    // Periodic snapshot
    const now = performance.now();
    if (now - this.lastSnapshotAt >= this.SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotAt = now;
      this.writeSnapshot();
    }

    const rttAvg = this.rtt.avg();
    const rttMin = this.rtt.min();
    const rttMax = this.rtt.max();
    const echoAvg = this.echoDist.avg();
    const echoMax = this.echoDist.max();
    const sentDAvg = this.sentDelta.avg();
    const sentDMax = this.sentDelta.max();
    const dtAvg = this.frameDelta.avg();
    const dtMin = this.frameDelta.min();
    const dtMax = this.frameDelta.max();
    const sendHz = this.sendRate.hz();
    const recvHz = this.recvRate.hz();
    const spdAvg = this.speed.avg();
    const spdMax = this.speed.max();
    const vehAvg = this.vehicleErr.avg();
    const vehMax = this.vehicleErr.max();
    const corrAvg = this.correctionDist.size() > 0 ? this.correctionDist.avg() : 0;

    const vSrvHz = this.vehicleServerRate.hz();
    const vInHz = this.vehicleInputRate.hz();
    const vJumpAvg = this.vehicleSnapJump.avg();
    const vJumpMax = this.vehicleSnapJump.max();
    const vSpdAvg = this.vehicleSpeed.avg();
    const vStaleAvg = this.vehicleStaleness.avg();
    const vStaleMax = this.vehicleStaleness.max();

    const lines = [
      `=== NET DIAG (F3 stop | F4 save) ===`,
      ``,
      `RTT          ${rttAvg.toFixed(0)}ms avg  ${rttMin.toFixed(0)}-${rttMax.toFixed(0)}ms`,
      `Echo Dist    ${echoAvg.toFixed(2)} avg  ${echoMax.toFixed(2)} max`,
      `Sent Delta   ${sentDAvg.toFixed(2)} avg  ${sentDMax.toFixed(2)} max`,
      `Send/Recv    ${sendHz}/${recvHz} Hz`,
      ``,
      `Speed        ${spdAvg.toFixed(1)} avg  ${spdMax.toFixed(1)} max u/s`,
      `Frame dt     ${dtAvg.toFixed(1)}ms avg  ${dtMin.toFixed(1)}-${dtMax.toFixed(1)}ms`,
      `FPS (dt)     ${dtAvg > 0 ? (1000 / dtAvg).toFixed(0) : '?'}`,
      ``,
      `Corrections  ${this.correctionCount}  (${corrAvg.toFixed(2)} avg dist)`,
      `Teleports    ${this.teleportCount}`,
      `Pos          (${this.lastClientPos.x.toFixed(1)}, ${this.lastClientPos.y.toFixed(1)}, ${this.lastClientPos.z.toFixed(1)})`,
    ];

    // Vehicle section only when there's data
    if (vSrvHz > 0 || vehAvg > 0) {
      lines.push(
        ``,
        `--- VEHICLE ---`,
        `Srv Updates  ${vSrvHz} Hz  Input ${vInHz} Hz`,
        `Pred Error   ${vehAvg.toFixed(2)} avg  ${vehMax.toFixed(2)} max`,
        `Snap Jump    ${vJumpAvg.toFixed(2)} avg  ${vJumpMax.toFixed(2)} max`,
        `Srv Vel      ${vSpdAvg.toFixed(1)} u/s`,
        `Staleness    ${vStaleAvg.toFixed(0)}ms avg  ${vStaleMax.toFixed(0)}ms max`,
      );
    }

    lines.push(
      ``,
      `Log lines    ${this.sessionLog.length}`,
      `--- EVENTS ---`,
      ...this.recentLines,
    );

    this.overlay.textContent = lines.join('\n');
  }

  // ══════════════════════════════════════════════════════════════
  //  LOG INTERNALS
  // ══════════════════════════════════════════════════════════════

  private appendLog(msg: string): void {
    const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
    this.sessionLog.push(line);
    this.recentLines.push(line);
    if (this.recentLines.length > this.MAX_RECENT) this.recentLines.shift();
  }

  private writeSnapshot(): void {
    const parts = [
      `SNAPSHOT`,
      `rtt=${this.rtt.avg().toFixed(0)}/${this.rtt.max().toFixed(0)}ms`,
      `echo=${this.echoDist.avg().toFixed(2)}/${this.echoDist.max().toFixed(2)}`,
      `sentD=${this.sentDelta.max().toFixed(2)}max`,
      `rate=${this.sendRate.hz()}/${this.recvRate.hz()}Hz`,
      `spd=${this.speed.avg().toFixed(1)}`,
      `dt=${this.frameDelta.avg().toFixed(1)}/${this.frameDelta.max().toFixed(1)}ms`,
      `corr=${this.correctionCount}`,
      `tp=${this.teleportCount}`,
      `pos=(${this.lastClientPos.x.toFixed(1)},${this.lastClientPos.y.toFixed(1)},${this.lastClientPos.z.toFixed(1)})`,
    ];

    const vSrvHz = this.vehicleServerRate.hz();
    if (vSrvHz > 0 || this.vehicleErr.avg() > 0) {
      parts.push(
        `vSrv=${vSrvHz}Hz`,
        `vIn=${this.vehicleInputRate.hz()}Hz`,
        `vErr=${this.vehicleErr.avg().toFixed(2)}/${this.vehicleErr.max().toFixed(2)}`,
        `vJump=${this.vehicleSnapJump.avg().toFixed(2)}/${this.vehicleSnapJump.max().toFixed(2)}`,
        `vSpd=${this.vehicleSpeed.avg().toFixed(1)}`,
        `vStale=${this.vehicleStaleness.avg().toFixed(0)}/${this.vehicleStaleness.max().toFixed(0)}ms`,
      );
    }

    this.appendLog(parts.join('  '));
  }

  private downloadLog(): void {
    if (this.sessionLog.length === 0) return;
    if (this.visible) this.writeSnapshot();

    const ts = (this.recordingStartedAt || new Date().toISOString()).replace(/[:.]/g, '-');
    const filename = `netdiag-${ts}.log`;
    const header = [
      `BitWars Net Diagnostics Log`,
      `Recorded: ${this.recordingStartedAt || '?'}`,
      `Duration: ${(performance.now() / 1000).toFixed(0)}s`,
      `Corrections: ${this.correctionCount}  Teleports: ${this.teleportCount}`,
      ``,
      `LEGEND:`,
      `  SNAPSHOT  rtt=avg/max  echo=avg/max  sentD=max  rate=send/recv`,
      `            spd=avg  dt=avg/max  corr=N  tp=N  veh=avg  pos=xyz`,
      `  SERVER_CORRECTION  server changed our position`,
      `  LARGE_ECHO         echo > 5u from client pos`,
      `  LARGE_SENT_DELTA   moved > 10u between updates`,
      `  TELEPORT           forced reposition (respawn/admin)`,
      ``,
    ];

    const blob = new Blob(
      [header.join('\n') + this.sessionLog.join('\n') + '\n'],
      { type: 'text/plain' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ══════════════════════════════════════════════════════════════

  private createOverlay(): void {
    if (!this.isDev) return;
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
      'background:rgba(0,0,0,0.82)', 'color:#0f0',
      'font:11px/1.45 "Courier New",monospace',
      'padding:10px 14px', 'border-radius:6px', 'pointer-events:none',
      'white-space:pre', 'max-width:480px', 'display:none',
      'border:1px solid rgba(0,255,0,0.2)',
    ].join(';');
    document.body.appendChild(el);
    this.overlay = el;
  }

  dispose(): void {
    if (this.isDev) {
      window.removeEventListener('keydown', this.handleKeyDown);
    }
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
  }
}
