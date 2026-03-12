import * as THREE from 'three';

/**
 * Fullscreen shader overlay for warzone screen effects:
 * - Moody dark vignette with amber tint
 * - Red damage pulse with distortion
 * - Animated film grain
 * - Subtle dust haze
 * - Faint scanlines
 */

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uDamage;
uniform float uTime;

varying vec2 vUv;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
    vec2 uv = vUv;
    vec2 center = uv - 0.5;
    float dist = length(center) * 2.0;

    // ── Warzone vignette — wider, darker, with slight amber tint ──
    float vignette = smoothstep(0.5, 1.6, dist);
    vec3 vignetteColor = vec3(0.03, 0.02, 0.01) * vignette;
    float vignetteAlpha = vignette * 0.25;

    // ── Subtle dust haze overlay ──
    float haze = 0.008 + 0.008 * sin(uTime * 0.25 + uv.x * 4.0) * cos(uTime * 0.18 + uv.y * 3.0);
    haze += 0.005 * sin(uTime * 0.4 + uv.y * 6.0);
    vec3 hazeColor = vec3(0.12, 0.10, 0.07);

    // ── Damage red pulse (enhanced) ──
    float dmg = uDamage;
    float pulse = 0.7 + 0.3 * sin(uTime * 20.0);
    float damageRing = smoothstep(0.1, 0.85, dist) * dmg * pulse;

    // Edge warping when damaged
    float warp = dmg * 0.015 * dist;
    vec2 warpedUv = center * (1.0 + warp) + 0.5;
    float warpDist = length(warpedUv - 0.5) * 2.0;
    float edgeDistort = smoothstep(0.5, 1.0, warpDist) * dmg * 0.35;

    vec3 damageColor = vec3(0.95, 0.05, 0.0) * damageRing;
    float damageAlpha = damageRing * 0.7 + edgeDistort;

    // ── Film grain — animated ──
    float grain = hash(uv * 500.0 + fract(uTime * 7.13)) * 0.07 - 0.035;

    // ── Faint scanlines ──
    float scanline = sin(uv.y * 900.0) * 0.006;

    // ── Combine ──
    vec3 color = vignetteColor + damageColor + hazeColor * haze;
    float alpha = vignetteAlpha + damageAlpha + haze + abs(grain) * 0.5 + scanline;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.55));
}
`;

export class PostFX {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.ShaderMaterial;
  private damageAmount = 0;
  enabled = true;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uDamage: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(quad);
  }

  triggerDamage(intensity: number = 0.6): void {
    this.damageAmount = Math.min(1, this.damageAmount + intensity);
  }

  update(delta: number, elapsedTime: number): void {
    this.damageAmount = Math.max(0, this.damageAmount - delta * 2.0);
    this.material.uniforms.uDamage.value = this.damageAmount;
    this.material.uniforms.uTime.value = elapsedTime;
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) return;
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
