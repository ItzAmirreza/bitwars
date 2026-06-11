import * as THREE from 'three';

/**
 * GPU-optimized particle system with custom shaders.
 * Two layers, one draw call each:
 *  - glow:  additive blending — fire, sparks, flashes, thruster flames
 *  - solid: normal blending  — debris, dust, smoke (matte, never glows)
 * Tracers come from a fixed pool of Line objects (no per-shot allocation).
 */

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number; g: number; b: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: boolean;
  /** Size multiplier over lifetime: >1 grows (smoke), <1 shrinks. */
  growth: number;
}

const MAX_PARTICLES_PER_LAYER = 1400;
const TRACER_POOL_SIZE = 20;

// ── Shaders ──

const PARTICLE_VERTEX = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;

void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (280.0 / -mvPos.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
    gl_Position = projectionMatrix * mvPos;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 centered = abs(gl_PointCoord - vec2(0.5));
    float squareDist = max(centered.x, centered.y);
    float radialDist = length(centered * vec2(1.1, 1.1));
    float edgeFade = 1.0 - smoothstep(0.3, 0.48, squareDist);
    float cornerFade = 1.0 - smoothstep(0.42, 0.62, radialDist);
    float coreGlow = 1.0 - smoothstep(0.0, 0.25, squareDist);
    float alpha = edgeFade * cornerFade;

    vec3 color = vColor * (0.85 + coreGlow * 0.3);
    gl_FragColor = vec4(color, vAlpha * alpha);
}
`;

const SOLID_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 centered = abs(gl_PointCoord - vec2(0.5));
    float squareDist = max(centered.x, centered.y);
    float edgeFade = 1.0 - smoothstep(0.34, 0.5, squareDist);
    gl_FragColor = vec4(vColor, vAlpha * edgeFade);
}
`;

class ParticleLayer {
  particles: Particle[] = [];
  geometry: THREE.BufferGeometry;
  points: THREE.Points;
  private posArr: Float32Array;
  private colArr: Float32Array;
  private sizeArr: Float32Array;
  private alphaArr: Float32Array;

  constructor(scene: THREE.Scene, fragment: string, blending: THREE.Blending) {
    this.posArr = new Float32Array(MAX_PARTICLES_PER_LAYER * 3);
    this.colArr = new Float32Array(MAX_PARTICLES_PER_LAYER * 3);
    this.sizeArr = new Float32Array(MAX_PARTICLES_PER_LAYER);
    this.alphaArr = new Float32Array(MAX_PARTICLES_PER_LAYER);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1));
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: fragment,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  get full(): boolean {
    return this.particles.length >= MAX_PARTICLES_PER_LAYER;
  }

  push(p: Particle): void {
    if (this.particles.length < MAX_PARTICLES_PER_LAYER) this.particles.push(p);
  }

  update(delta: number): void {
    let alive = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      if (p.gravity) p.vy -= 14 * delta;
      p.vx *= 0.97;
      p.vz *= 0.97;

      const t = p.life / p.maxLife;
      const fade = 1 - t * t;
      const sizeT = 1 + (p.growth - 1) * t;

      const idx3 = alive * 3;
      this.posArr[idx3] = p.x;
      this.posArr[idx3 + 1] = p.y;
      this.posArr[idx3 + 2] = p.z;
      this.colArr[idx3] = p.r * fade;
      this.colArr[idx3 + 1] = p.g * fade;
      this.colArr[idx3 + 2] = p.b * fade;
      this.sizeArr[alive] = p.size * sizeT;
      this.alphaArr[alive] = fade;
      alive++;
    }

    for (let i = alive; i < Math.min(alive + 16, MAX_PARTICLES_PER_LAYER); i++) {
      this.posArr[i * 3 + 1] = -999;
      this.alphaArr[i] = 0;
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, alive);
  }

  clear(): void {
    this.particles.length = 0;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

interface PooledTracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  positions: Float32Array;
  active: boolean;
  birth: number;
  ttlMs: number;
  baseOpacity: number;
}

export class VFX {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private glow: ParticleLayer;
  private solid: ParticleLayer;

  // Muzzle flash light. Stays in the scene with intensity gating only —
  // toggling light visibility changes the scene light count, which forces
  // every lit material to recompile (multi-hundred-ms hitch).
  private muzzleLight: THREE.PointLight;
  private muzzleTimer = 0;
  private muzzleLightEnabled = true;
  private muzzleLightIntensityScale = 1;

  // Screen shake (stored only, applied by Engine around render)
  private shakeAmount = 0;
  shakeOffsetX = 0;
  shakeOffsetY = 0;

  private tracers: PooledTracer[] = [];
  private nextTracer = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.glow = new ParticleLayer(scene, GLOW_FRAGMENT, THREE.AdditiveBlending);
    this.solid = new ParticleLayer(scene, SOLID_FRAGMENT, THREE.NormalBlending);

    this.muzzleLight = new THREE.PointLight(0xff9944, 0, 14);
    scene.add(this.muzzleLight);

    // Fixed tracer pool: pre-built lines mean no per-shot allocation and the
    // line shader compiles during the loading screen, not on the first shot
    for (let i = 0; i < TRACER_POOL_SIZE; i++) {
      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(positions, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, material);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({
        line,
        material,
        positions,
        active: false,
        birth: 0,
        ttlMs: 0,
        baseOpacity: 0,
      });
    }
  }

  // ── Block break: matte debris + dust, deliberately NOT an explosion ──
  emitBlockDebris(x: number, y: number, z: number, colorHex: number): void {
    const col = new THREE.Color(colorHex);

    // Chunky block-colored fragments
    const count = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const shade = 0.7 + Math.random() * 0.5;
      this.solid.push({
        x: x + 0.5 + (Math.random() - 0.5) * 0.5,
        y: y + 0.5 + (Math.random() - 0.5) * 0.5,
        z: z + 0.5 + (Math.random() - 0.5) * 0.5,
        vx: (Math.random() - 0.5) * 5.5,
        vy: Math.random() * 4.5 + 2,
        vz: (Math.random() - 0.5) * 5.5,
        r: col.r * shade,
        g: col.g * shade,
        b: col.b * shade,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.4,
        size: 6 + Math.random() * 4,
        gravity: true,
        growth: 0.85,
      });
    }

    // Soft dust puff in the block's own tone
    for (let i = 0; i < 3; i++) {
      const dustShade = 0.55 + Math.random() * 0.25;
      this.solid.push({
        x: x + 0.5 + (Math.random() - 0.5) * 0.6,
        y: y + 0.5 + (Math.random() - 0.5) * 0.4,
        z: z + 0.5 + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 1.4,
        vy: 0.5 + Math.random() * 1.1,
        vz: (Math.random() - 0.5) * 1.4,
        r: col.r * dustShade + 0.12,
        g: col.g * dustShade + 0.12,
        b: col.b * dustShade + 0.11,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.4,
        size: 11 + Math.random() * 7,
        gravity: false,
        growth: 1.8,
      });
    }
  }

  // ── Explosion: flash core + fireball + sparks + shockwave ring + smoke ──
  emitExplosion(x: number, y: number, z: number, radius: number): void {
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const scale = 0.75 + radius * 0.28;

    // White-hot core flash (very short)
    for (let i = 0; i < 6; i++) {
      this.glow.push({
        x: cx + (Math.random() - 0.5) * 0.4,
        y: cy + (Math.random() - 0.5) * 0.4,
        z: cz + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        vz: (Math.random() - 0.5) * 2,
        r: 1, g: 0.96, b: 0.82,
        life: 0,
        maxLife: 0.1 + Math.random() * 0.06,
        size: (20 + Math.random() * 10) * Math.min(1.6, scale),
        gravity: false,
        growth: 1.5,
      });
    }

    // Fireball
    const fireCount = Math.min(30, Math.floor(radius * 9));
    for (let i = 0; i < fireCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      const speed = (2 + Math.random() * 4.6) * scale;
      const hue = 0.02 + Math.random() * 0.09;
      const c = new THREE.Color().setHSL(hue, 1, 0.48 + Math.random() * 0.3);

      this.glow.push({
        x: cx + (Math.random() - 0.5) * 0.5,
        y: cy + (Math.random() - 0.5) * 0.5,
        z: cz + (Math.random() - 0.5) * 0.5,
        vx: Math.cos(theta) * ring * speed,
        vy: u * speed + 0.3 * radius,
        vz: Math.sin(theta) * ring * speed,
        r: c.r, g: c.g, b: c.b,
        life: 0,
        maxLife: 0.26 + Math.random() * 0.34,
        size: 12 + Math.random() * 8,
        gravity: true,
        growth: 0.7,
      });
    }

    // Hot sparks that arc out and fall
    for (let i = 0; i < 9; i++) {
      const theta = Math.random() * Math.PI * 2;
      const speed = (5 + Math.random() * 7) * scale;
      this.glow.push({
        x: cx, y: cy, z: cz,
        vx: Math.cos(theta) * speed,
        vy: 2 + Math.random() * 6,
        vz: Math.sin(theta) * speed,
        r: 1, g: 0.75 + Math.random() * 0.2, b: 0.25,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.4,
        size: 3.5 + Math.random() * 3,
        gravity: true,
        growth: 0.6,
      });
    }

    // Horizontal shockwave ring
    const ringCount = 12;
    for (let i = 0; i < ringCount; i++) {
      const theta = (i / ringCount) * Math.PI * 2;
      const speed = 11 * scale;
      this.glow.push({
        x: cx, y: cy + 0.1, z: cz,
        vx: Math.cos(theta) * speed,
        vy: 0,
        vz: Math.sin(theta) * speed,
        r: 1, g: 0.85, b: 0.6,
        life: 0,
        maxLife: 0.2,
        size: 7,
        gravity: false,
        growth: 0.5,
      });
    }

    // Lingering smoke column (matte, rises and expands)
    const smokeCount = Math.min(16, Math.floor(radius * 5));
    for (let i = 0; i < smokeCount; i++) {
      const v = 0.14 + Math.random() * 0.12;
      this.solid.push({
        x: cx + (Math.random() - 0.5) * radius * 0.7,
        y: cy + Math.random() * 0.8,
        z: cz + (Math.random() - 0.5) * radius * 0.7,
        vx: (Math.random() - 0.5) * 1.6,
        vy: 1.2 + Math.random() * 2,
        vz: (Math.random() - 0.5) * 1.6,
        r: v, g: v, b: v * 1.05,
        life: 0,
        maxLife: 0.9 + Math.random() * 0.7,
        size: 14 + Math.random() * 9,
        gravity: false,
        growth: 2.1,
      });
    }
  }

  // ── Muzzle flash (light + spark particles) ──
  emitMuzzleFlash(): void {
    this.muzzleTimer = 0.05;

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    const origin = this.camera.position.clone()
      .add(dir.clone().multiplyScalar(0.6))
      .add(right.clone().multiplyScalar(0.2))
      .add(up.clone().multiplyScalar(-0.12));

    for (let i = 0; i < 5; i++) {
      this.glow.push({
        x: origin.x,
        y: origin.y,
        z: origin.z,
        vx: dir.x * 14 + (Math.random() - 0.5) * 5,
        vy: dir.y * 14 + (Math.random() - 0.5) * 5 + 1,
        vz: dir.z * 14 + (Math.random() - 0.5) * 5,
        r: 1, g: 0.7 + Math.random() * 0.3, b: 0.1 + Math.random() * 0.2,
        life: 0,
        maxLife: 0.03 + Math.random() * 0.04,
        size: 5 + Math.random() * 6,
        gravity: false,
        growth: 1,
      });
    }
  }

  // ── World-space muzzle flash (for vehicles / remote shots) ──
  emitMuzzleFlashAt(pos: THREE.Vector3, dir: THREE.Vector3, colorHex = 0xff9944): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < 6; i++) {
      this.glow.push({
        x: pos.x + (Math.random() - 0.5) * 0.3,
        y: pos.y + (Math.random() - 0.5) * 0.3,
        z: pos.z + (Math.random() - 0.5) * 0.3,
        vx: dir.x * 16 + (Math.random() - 0.5) * 6,
        vy: dir.y * 16 + (Math.random() - 0.5) * 6 + 0.5,
        vz: dir.z * 16 + (Math.random() - 0.5) * 6,
        r: col.r, g: col.g, b: col.b,
        life: 0,
        maxLife: 0.03 + Math.random() * 0.05,
        size: 7 + Math.random() * 7,
        gravity: false,
        growth: 1,
      });
    }
  }

  setMuzzleLightBudget(enabled: boolean, intensityScale = 1): void {
    this.muzzleLightEnabled = enabled;
    this.muzzleLightIntensityScale = THREE.MathUtils.clamp(intensityScale, 0, 1);
    if (!enabled) {
      this.muzzleLight.intensity = 0;
    }
  }

  getActiveLightCount(): number {
    return this.muzzleLight.intensity > 0.01 ? 1 : 0;
  }

  // ── Impact dust (matte) with a couple of glow sparks ──
  emitImpact(x: number, y: number, z: number): void {
    for (let i = 0; i < 4; i++) {
      this.solid.push({
        x: x + 0.5, y: y + 0.5, z: z + 0.5,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2 + 0.5,
        vz: (Math.random() - 0.5) * 3,
        r: 0.42, g: 0.42, b: 0.39,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.2,
        size: 6 + Math.random() * 5,
        gravity: true,
        growth: 1.5,
      });
    }
    for (let i = 0; i < 2; i++) {
      this.glow.push({
        x: x + 0.5, y: y + 0.5, z: z + 0.5,
        vx: (Math.random() - 0.5) * 5,
        vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 5,
        r: 1, g: 0.8, b: 0.45,
        life: 0,
        maxLife: 0.08 + Math.random() * 0.08,
        size: 3 + Math.random() * 2.5,
        gravity: true,
        growth: 0.7,
      });
    }
  }

  // ── Small glow trail (bullet-like projectiles) ──
  emitProjectileTrail(x: number, y: number, z: number, colorHex: number): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < 2; i++) {
      this.glow.push({
        x: x + (Math.random() - 0.5) * 0.12,
        y: y + (Math.random() - 0.5) * 0.12,
        z: z + (Math.random() - 0.5) * 0.12,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2 + 0.2,
        vz: (Math.random() - 0.5) * 1.2,
        r: Math.min(1, col.r * 0.95 + 0.05),
        g: Math.min(1, col.g * 0.95 + 0.05),
        b: Math.min(1, col.b * 0.95 + 0.05),
        life: 0,
        maxLife: 0.1 + Math.random() * 0.12,
        size: 3.2 + Math.random() * 2,
        gravity: false,
        growth: 0.8,
      });
    }
  }

  // ── Rocket thruster: bright exhaust flame + lingering smoke trail ──
  private thrusterTick = 0;
  emitThruster(
    x: number, y: number, z: number,
    dirX: number, dirY: number, dirZ: number,
    colorHex: number,
  ): void {
    const col = new THREE.Color(colorHex);

    // Hot exhaust flame pushed opposite to travel
    this.glow.push({
      x: x - dirX * 0.25 + (Math.random() - 0.5) * 0.08,
      y: y - dirY * 0.25 + (Math.random() - 0.5) * 0.08,
      z: z - dirZ * 0.25 + (Math.random() - 0.5) * 0.08,
      vx: -dirX * 6 + (Math.random() - 0.5) * 1.5,
      vy: -dirY * 6 + (Math.random() - 0.5) * 1.5,
      vz: -dirZ * 6 + (Math.random() - 0.5) * 1.5,
      r: Math.min(1, 0.65 + col.r * 0.45),
      g: Math.min(1, 0.45 + col.g * 0.4),
      b: 0.18 + col.b * 0.25,
      life: 0,
      maxLife: 0.07 + Math.random() * 0.06,
      size: 7 + Math.random() * 4,
      gravity: false,
      growth: 0.55,
    });

    // Every other tick, a matte smoke puff that hangs in the air
    this.thrusterTick++;
    if ((this.thrusterTick & 1) === 0) {
      const v = 0.3 + Math.random() * 0.14;
      this.solid.push({
        x: x - dirX * 0.4,
        y: y - dirY * 0.4,
        z: z - dirZ * 0.4,
        vx: -dirX * 1.2 + (Math.random() - 0.5) * 0.8,
        vy: -dirY * 1.2 + 0.5 + Math.random() * 0.5,
        vz: -dirZ * 1.2 + (Math.random() - 0.5) * 0.8,
        r: v, g: v, b: v * 1.04,
        life: 0,
        maxLife: 0.55 + Math.random() * 0.35,
        size: 7 + Math.random() * 4,
        gravity: false,
        growth: 2.4,
      });
    }
  }

  // ── Kinetic penetrator beam effect ──
  emitKineticBeam(from: THREE.Vector3, to: THREE.Vector3): void {
    const dist = from.distanceTo(to);
    const count = Math.min(50, Math.floor(dist * 1.5));
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const isCyan = Math.random() > 0.3;
      let r: number, g: number, b: number;
      if (isCyan) {
        r = 0.0 + Math.random() * 0.15;
        g = 0.7 + Math.random() * 0.3;
        b = 0.9 + Math.random() * 0.1;
      } else {
        r = 0.85 + Math.random() * 0.15;
        g = 0.9 + Math.random() * 0.1;
        b = 1.0;
      }
      this.glow.push({
        x: from.x + (to.x - from.x) * t + (Math.random() - 0.5) * 0.8,
        y: from.y + (to.y - from.y) * t + (Math.random() - 0.5) * 0.8,
        z: from.z + (to.z - from.z) * t + (Math.random() - 0.5) * 0.8,
        vx: (Math.random() - 0.5) * 2,
        vy: -2 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 2,
        r, g, b,
        life: 0,
        maxLife: 0.3 + Math.random() * 0.4,
        size: 7 + Math.random() * 7,
        gravity: false,
        growth: 1,
      });
    }

    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 8;
      this.glow.push({
        x: to.x + (Math.random() - 0.5) * 1.5,
        y: to.y + Math.random() * 0.5,
        z: to.z + (Math.random() - 0.5) * 1.5,
        vx: Math.cos(angle) * speed,
        vy: 3 + Math.random() * 6,
        vz: Math.sin(angle) * speed,
        r: 0.1, g: 0.8, b: 1.0,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.5,
        size: 10 + Math.random() * 6,
        gravity: true,
        growth: 1,
      });
    }
  }

  // ── Vehicle block collision (glow sparks + matte dust) ──
  emitVehicleCollision(x: number, y: number, z: number, count: number, vx: number, vy: number, vz: number): void {
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const invSpeed = speed > 0.01 ? 1 / speed : 0;
    const ndx = -vx * invSpeed;
    const ndy = -vy * invSpeed;
    const ndz = -vz * invSpeed;

    const sparkCount = Math.min(30, count * 4);
    for (let i = 0; i < sparkCount; i++) {
      const bright = 0.7 + Math.random() * 0.3;
      this.glow.push({
        x: x + (Math.random() - 0.5) * 2,
        y: y + (Math.random() - 0.5) * 2,
        z: z + (Math.random() - 0.5) * 2,
        vx: ndx * speed * 0.4 + (Math.random() - 0.5) * 8,
        vy: ndy * speed * 0.4 + Math.random() * 6 + 2,
        vz: ndz * speed * 0.4 + (Math.random() - 0.5) * 8,
        r: 1.0 * bright, g: (0.5 + Math.random() * 0.4) * bright, b: 0.1 * bright,
        life: 0,
        maxLife: 0.15 + Math.random() * 0.35,
        size: 4 + Math.random() * 5,
        gravity: true,
        growth: 0.7,
      });
    }

    const dustCount = Math.min(15, count * 2);
    for (let i = 0; i < dustCount; i++) {
      const v = 0.3 + Math.random() * 0.25;
      this.solid.push({
        x: x + (Math.random() - 0.5) * 3,
        y: y + (Math.random() - 0.5) * 2,
        z: z + (Math.random() - 0.5) * 3,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 4 + 1,
        vz: (Math.random() - 0.5) * 6,
        r: v, g: v, b: v * 0.9,
        life: 0,
        maxLife: 0.28 + Math.random() * 0.4,
        size: 9 + Math.random() * 7,
        gravity: true,
        growth: 1.6,
      });
    }
  }

  // ── Bullet tracer (pooled, no allocation) ──
  emitTracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    options: {
      opacity?: number;
      ttlMs?: number;
      particleCount?: number;
      particleSize?: number;
      particleJitter?: number;
    } = {},
  ): void {
    const baseOpacity = options.opacity ?? 0.45;
    const ttlMs = options.ttlMs ?? 70;

    // Take the next pool slot (steals the oldest if all are active)
    const tracer = this.tracers[this.nextTracer]!;
    this.nextTracer = (this.nextTracer + 1) % TRACER_POOL_SIZE;

    tracer.positions[0] = from.x;
    tracer.positions[1] = from.y;
    tracer.positions[2] = from.z;
    tracer.positions[3] = to.x;
    tracer.positions[4] = to.y;
    tracer.positions[5] = to.z;
    const attr = tracer.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    tracer.line.geometry.computeBoundingSphere?.();
    tracer.material.color.set(color);
    tracer.material.opacity = baseOpacity;
    tracer.line.visible = true;
    tracer.active = true;
    tracer.birth = performance.now();
    tracer.ttlMs = ttlMs;
    tracer.baseOpacity = baseOpacity;

    const particleCount = Math.max(0, Math.floor(options.particleCount ?? 0));
    const particleSize = options.particleSize ?? 0;
    if (particleCount <= 0 || particleSize <= 0) return;

    const col = new THREE.Color(color);
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist <= 0.001) return;
    dir.multiplyScalar(1 / dist);
    const jitter = options.particleJitter ?? 0.06;
    const life = Math.max(0.04, ttlMs / 1000);

    for (let i = 0; i < particleCount; i++) {
      const t = particleCount === 1 ? 0.5 : i / (particleCount - 1);
      this.glow.push({
        x: from.x + dir.x * dist * t + (Math.random() - 0.5) * jitter,
        y: from.y + dir.y * dist * t + (Math.random() - 0.5) * jitter,
        z: from.z + dir.z * dist * t + (Math.random() - 0.5) * jitter,
        vx: dir.x * 1.8 + (Math.random() - 0.5) * 0.35,
        vy: dir.y * 1.8 + (Math.random() - 0.5) * 0.35,
        vz: dir.z * 1.8 + (Math.random() - 0.5) * 0.35,
        r: Math.min(1, col.r * 1.2 + 0.08),
        g: Math.min(1, col.g * 1.2 + 0.08),
        b: Math.min(1, col.b * 1.2 + 0.08),
        life: 0,
        maxLife: life * (0.75 + Math.random() * 0.2),
        size: particleSize * (0.8 + Math.random() * 0.4),
        gravity: false,
        growth: 1,
      });
    }
  }

  // ── Screen shake ──
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  // ── Per-frame update ──
  update(delta: number): void {
    this.glow.update(delta);
    this.solid.update(delta);

    // ── Muzzle flash light (intensity gating only — never toggle visible) ──
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= delta;
      if (this.muzzleLightEnabled && this.muzzleTimer > 0) {
        this.muzzleLight.intensity =
          5 * (this.muzzleTimer / 0.05) * this.muzzleLightIntensityScale;
        this.muzzleLight.position.copy(this.camera.position);
      } else {
        this.muzzleLight.intensity = 0;
      }
    } else {
      this.muzzleLight.intensity = 0;
    }

    // ── Screen shake (compute offsets, don't touch camera) ──
    if (this.shakeAmount > 0.001) {
      this.shakeOffsetX = (Math.random() - 0.5) * this.shakeAmount * 0.04;
      this.shakeOffsetY = (Math.random() - 0.5) * this.shakeAmount * 0.04;

      this.shakeAmount *= Math.max(0, 1 - delta * 14);
      if (this.shakeAmount < 0.001) this.shakeAmount = 0;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    // ── Tracers ──
    const now = performance.now();
    for (const tracer of this.tracers) {
      if (!tracer.active) continue;
      const age = now - tracer.birth;
      if (age > tracer.ttlMs) {
        tracer.active = false;
        tracer.line.visible = false;
        tracer.material.opacity = 0;
      } else {
        tracer.material.opacity = tracer.baseOpacity * (1 - age / tracer.ttlMs);
      }
    }
  }

  /** Clear all active particles, tracers, and shake (used on map reset). */
  clearAll(): void {
    this.glow.clear();
    this.solid.clear();
    for (const tracer of this.tracers) {
      tracer.active = false;
      tracer.line.visible = false;
      tracer.material.opacity = 0;
    }
    this.shakeAmount = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.muzzleTimer = 0;
    this.muzzleLight.intensity = 0;
  }

  dispose(): void {
    this.glow.dispose(this.scene);
    this.solid.dispose(this.scene);
    this.scene.remove(this.muzzleLight);
    for (const tracer of this.tracers) {
      this.scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.material.dispose();
    }
  }
}
