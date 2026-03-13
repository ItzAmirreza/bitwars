import * as THREE from 'three';

interface Snapshot {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: { yaw: number; pitch: number };
  timestamp: number; // performance.now() when received
}

/**
 * Interpolation buffer for smooth remote player rendering.
 * Stores position snapshots and interpolates between them,
 * rendering players slightly behind real-time (BUFFER_TIME ms).
 * Falls back to velocity-based extrapolation when data is stale.
 */
export class InterpolationBuffer {
  private buffer: Snapshot[] = [];
  private readonly BUFFER_TIME = 100; // ms behind real-time
  private readonly MAX_SNAPSHOTS = 10;
  private readonly EXTRAPOLATION_LIMIT = 200; // ms max extrapolation

  push(pos: THREE.Vector3, vel: THREE.Vector3, rot: { yaw: number; pitch: number }): void {
    this.buffer.push({
      pos: pos.clone(),
      vel: vel.clone(),
      rot: { yaw: rot.yaw, pitch: rot.pitch },
      timestamp: performance.now(),
    });
    if (this.buffer.length > this.MAX_SNAPSHOTS) {
      this.buffer.shift();
    }
  }

  sample(outPos: THREE.Vector3, outRot: { yaw: number; pitch: number }): void {
    if (this.buffer.length === 0) return;

    const renderTime = performance.now() - this.BUFFER_TIME;

    // Find the two snapshots that straddle renderTime
    let i = 0;
    while (i < this.buffer.length - 1 && this.buffer[i + 1].timestamp <= renderTime) {
      i++;
    }

    if (i >= this.buffer.length - 1) {
      // Extrapolation: past the latest snapshot
      const latest = this.buffer[this.buffer.length - 1];
      const elapsed = (renderTime - latest.timestamp) / 1000;
      const clampedElapsed = Math.min(elapsed, this.EXTRAPOLATION_LIMIT / 1000);

      if (clampedElapsed > 0) {
        outPos.copy(latest.pos).addScaledVector(latest.vel, clampedElapsed);
      } else {
        outPos.copy(latest.pos);
      }
      outRot.yaw = latest.rot.yaw;
      outRot.pitch = latest.rot.pitch;
    } else {
      // Interpolation between buffer[i] and buffer[i+1]
      const a = this.buffer[i];
      const b = this.buffer[i + 1];
      const span = b.timestamp - a.timestamp;
      const t = span > 0 ? (renderTime - a.timestamp) / span : 0;
      const ct = Math.max(0, Math.min(1, t));

      outPos.lerpVectors(a.pos, b.pos, ct);

      // Shortest-path yaw interpolation
      let dyaw = b.rot.yaw - a.rot.yaw;
      if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      outRot.yaw = a.rot.yaw + dyaw * ct;

      outRot.pitch = a.rot.pitch + (b.rot.pitch - a.rot.pitch) * ct;
    }

    // Prune old snapshots (keep at least 2)
    while (this.buffer.length > 2 && this.buffer[1].timestamp < renderTime) {
      this.buffer.shift();
    }
  }

  hasData(): boolean {
    return this.buffer.length > 0;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
