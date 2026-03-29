import * as THREE from 'three';

/**
 * GPU-optimized particle system with custom shader.
 * Renders soft glowing circles instead of hard squares.
 * Single draw call for all particles.
 */

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number; g: number; b: number;
  life: number;
  maxLife: number;
  size: number;
  gravity: boolean;
}

const MAX_PARTICLES = 2000;

// ── Custom particle shaders ──

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
    gl_PointSize = clamp(gl_PointSize, 1.0, 80.0);
    gl_Position = projectionMatrix * mvPos;
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Soft core + outer glow
    float core = 1.0 - smoothstep(0.0, 0.2, dist);
    float glow = 1.0 - smoothstep(0.1, 0.5, dist);
    float alpha = (core * 0.9 + glow * 0.5) * vAlpha;

    // Brighten core for bloom-like effect
    vec3 color = vColor + vColor * core * 0.4;

    gl_FragColor = vec4(color, alpha);
}
`;

export class VFX {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private particles: Particle[] = [];
  private geometry: THREE.BufferGeometry;
  private points: THREE.Points;

  private posArr: Float32Array;
  private colArr: Float32Array;
  private sizeArr: Float32Array;
  private alphaArr: Float32Array;

  // Muzzle flash light
  private muzzleLight: THREE.PointLight;
  private muzzleTimer = 0;

  // Screen shake (stored only, applied by Engine around render)
  private shakeAmount = 0;
  shakeOffsetX = 0;
  shakeOffsetY = 0;

  // Tracers
  private tracers: { mesh: THREE.Line; birth: number }[] = [];

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    // Buffers
    this.posArr = new Float32Array(MAX_PARTICLES * 3);
    this.colArr = new Float32Array(MAX_PARTICLES * 3);
    this.sizeArr = new Float32Array(MAX_PARTICLES);
    this.alphaArr = new Float32Array(MAX_PARTICLES);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colArr, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeArr, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaArr, 1));
    this.geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Muzzle flash point light
    this.muzzleLight = new THREE.PointLight(0xff9944, 0, 14);
    scene.add(this.muzzleLight);
  }

  // ── Block debris ──
  emitBlockDebris(x: number, y: number, z: number, colorHex: number): void {
    const col = new THREE.Color(colorHex);
    const count = 5 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + 0.5 + (Math.random() - 0.5) * 0.4,
        y: y + 0.5 + (Math.random() - 0.5) * 0.4,
        z: z + 0.5 + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 5,
        vy: Math.random() * 4 + 2,
        vz: (Math.random() - 0.5) * 5,
        r: col.r * (0.8 + Math.random() * 0.4),
        g: col.g * (0.8 + Math.random() * 0.4),
        b: col.b * (0.8 + Math.random() * 0.4),
        life: 0,
        maxLife: 0.4 + Math.random() * 0.5,
        size: 8 + Math.random() * 6,
        gravity: true,
      });
    }
  }

  // ── Explosion (fire + smoke) ──
  emitExplosion(x: number, y: number, z: number, radius: number): void {
    const count = Math.min(80, Math.floor(radius * 22));

    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const theta = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      const dirX = Math.cos(theta) * ring;
      const dirY = u;
      const dirZ = Math.sin(theta) * ring;
      const speed = (1.8 + Math.random() * 4.8) * (0.75 + radius * 0.28);

      const isFire = Math.random() > 0.25;
      let r: number, g: number, b: number;

      if (isFire) {
        const hue = 0.02 + Math.random() * 0.1;
        const c = new THREE.Color().setHSL(hue, 1, 0.45 + Math.random() * 0.35);
        r = c.r; g = c.g; b = c.b;
      } else {
        const v = 0.15 + Math.random() * 0.2;
        r = v; g = v; b = v;
      }

      const buoyancy = (isFire ? 0.25 : 0.12) * radius;

      this.particles.push({
        x: x + 0.5 + (Math.random() - 0.5) * 0.5,
        y: y + 0.5 + (Math.random() - 0.5) * 0.5,
        z: z + 0.5 + (Math.random() - 0.5) * 0.5,
        vx: dirX * speed,
        vy: dirY * speed + buoyancy,
        vz: dirZ * speed,
        r, g, b,
        life: 0,
        maxLife: 0.3 + Math.random() * 0.7,
        size: isFire ? 14 + Math.random() * 10 : 18 + Math.random() * 12,
        gravity: isFire,
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

    for (let i = 0; i < 5 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: origin.x,
        y: origin.y,
        z: origin.z,
        vx: dir.x * 14 + (Math.random() - 0.5) * 5,
        vy: dir.y * 14 + (Math.random() - 0.5) * 5 + 1,
        vz: dir.z * 14 + (Math.random() - 0.5) * 5,
        r: 1, g: 0.7 + Math.random() * 0.3, b: 0.1 + Math.random() * 0.2,
        life: 0,
        maxLife: 0.03 + Math.random() * 0.04,
        size: 6 + Math.random() * 8,
        gravity: false,
      });
    }
  }

  // ── World-space muzzle flash (for vehicles / remote shots) ──
  emitMuzzleFlashAt(pos: THREE.Vector3, dir: THREE.Vector3, colorHex = 0xff9944): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < 6 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * 0.3,
        y: pos.y + (Math.random() - 0.5) * 0.3,
        z: pos.z + (Math.random() - 0.5) * 0.3,
        vx: dir.x * 16 + (Math.random() - 0.5) * 6,
        vy: dir.y * 16 + (Math.random() - 0.5) * 6 + 0.5,
        vz: dir.z * 16 + (Math.random() - 0.5) * 6,
        r: col.r, g: col.g, b: col.b,
        life: 0,
        maxLife: 0.03 + Math.random() * 0.05,
        size: 8 + Math.random() * 10,
        gravity: false,
      });
    }
  }

  // ── Impact dust ──
  emitImpact(x: number, y: number, z: number): void {
    for (let i = 0; i < 5 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + 0.5, y: y + 0.5, z: z + 0.5,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2 + 0.5,
        vz: (Math.random() - 0.5) * 3,
        r: 0.55, g: 0.55, b: 0.5,
        life: 0,
        maxLife: 0.25 + Math.random() * 0.2,
        size: 5 + Math.random() * 5,
        gravity: true,
      });
    }
  }

  // ── Projectile trail ──
  emitProjectileTrail(x: number, y: number, z: number, colorHex: number): void {
    const col = new THREE.Color(colorHex);
    for (let i = 0; i < 2 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.15,
        y: y + (Math.random() - 0.5) * 0.15,
        z: z + (Math.random() - 0.5) * 0.15,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5 + 0.3,
        vz: (Math.random() - 0.5) * 1.5,
        r: col.r, g: col.g, b: col.b,
        life: 0,
        maxLife: 0.15 + Math.random() * 0.2,
        size: 4 + Math.random() * 4,
        gravity: false,
      });
    }
  }

  // ── Kinetic penetrator beam effect ──
  emitKineticBeam(from: THREE.Vector3, to: THREE.Vector3): void {
    // Bright cyan/white beam particles along the strike path
    const dist = from.distanceTo(to);
    const count = Math.min(50, Math.floor(dist * 1.5));
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const t = Math.random();
      // Cyan/white color variation
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
      const px = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * 0.8;
      const py = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * 0.8;
      const pz = from.z + (to.z - from.z) * t + (Math.random() - 0.5) * 0.8;
      this.particles.push({
        x: px, y: py, z: pz,
        vx: (Math.random() - 0.5) * 2,
        vy: -2 + Math.random() * 4,
        vz: (Math.random() - 0.5) * 2,
        r, g, b,
        life: 0,
        maxLife: 0.3 + Math.random() * 0.4,
        size: 8 + Math.random() * 10,
        gravity: false,
      });
    }

    // Impact burst at the bottom
    for (let i = 0; i < 20 && this.particles.length < MAX_PARTICLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 8;
      this.particles.push({
        x: to.x + (Math.random() - 0.5) * 1.5,
        y: to.y + Math.random() * 0.5,
        z: to.z + (Math.random() - 0.5) * 1.5,
        vx: Math.cos(angle) * speed,
        vy: 3 + Math.random() * 6,
        vz: Math.sin(angle) * speed,
        r: 0.1, g: 0.8, b: 1.0,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.5,
        size: 12 + Math.random() * 8,
        gravity: true,
      });
    }
  }

  // ── Bullet tracer ──
  emitTracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ mesh: line, birth: performance.now() });
  }

  // ── Screen shake ──
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  // ── Per-frame update ──
  update(delta: number): void {
    // ── Update particles ──
    let alive = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;

      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      // Physics
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;
      if (p.gravity) p.vy -= 14 * delta;
      p.vx *= 0.97;
      p.vz *= 0.97;

      // Fade
      const t = p.life / p.maxLife;
      const fade = 1 - t * t;

      const idx3 = alive * 3;
      this.posArr[idx3] = p.x;
      this.posArr[idx3 + 1] = p.y;
      this.posArr[idx3 + 2] = p.z;
      this.colArr[idx3] = p.r * fade;
      this.colArr[idx3 + 1] = p.g * fade;
      this.colArr[idx3 + 2] = p.b * fade;
      this.sizeArr[alive] = p.size * (0.5 + fade * 0.5);
      this.alphaArr[alive] = fade;
      alive++;
    }

    // Hide remaining
    for (let i = alive; i < Math.min(alive + 16, MAX_PARTICLES); i++) {
      this.posArr[i * 3 + 1] = -999;
      this.alphaArr[i] = 0;
    }

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, alive);

    // ── Muzzle flash light ──
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= delta;
      this.muzzleLight.intensity = this.muzzleTimer > 0 ? 5 * (this.muzzleTimer / 0.05) : 0;
      this.muzzleLight.position.copy(this.camera.position);
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
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      const age = now - tr.birth;
      if (age > 70) {
        this.scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        (tr.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      } else {
        (tr.mesh.material as THREE.LineBasicMaterial).opacity = 0.45 * (1 - age / 70);
      }
    }
  }

  /** Clear all active particles, tracers, and shake (used on map reset). */
  clearAll(): void {
    this.particles.length = 0;
    this.geometry.setDrawRange(0, 0);
    for (const t of this.tracers) {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
    this.tracers.length = 0;
    this.shakeAmount = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.muzzleTimer = 0;
    this.muzzleLight.intensity = 0;
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.scene.remove(this.muzzleLight);
    for (const t of this.tracers) {
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
    }
  }
}
