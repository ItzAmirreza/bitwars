import * as THREE from 'three';

/**
 * Fullscreen shader overlay for screen effects:
 * - Atmospheric dark vignette (always on)
 * - Red damage pulse with chromatic-style distortion
 * - Speed lines hint when moving fast
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

void main() {
    vec2 uv = vUv;
    vec2 center = uv - 0.5;
    float dist = length(center) * 2.0;

    // ── Base atmospheric vignette ──
    float baseVignette = smoothstep(0.5, 1.5, dist);
    float baseAlpha = baseVignette * 0.25;
    vec3 baseColor = vec3(0.0);

    // ── Damage red pulse ──
    float dmg = uDamage;
    float pulse = 0.75 + 0.25 * sin(uTime * 18.0);
    float damageRing = smoothstep(0.15, 0.9, dist) * dmg * pulse;

    // Slight warping at edges when damaged
    float warp = dmg * 0.012 * dist;
    vec2 warpedUv = center * (1.0 + warp) + 0.5;
    float warpDist = length(warpedUv - 0.5) * 2.0;
    float edgeDistort = smoothstep(0.6, 1.0, warpDist) * dmg * 0.3;

    // Combine
    vec3 damageColor = vec3(0.9, 0.05, 0.02) * damageRing;
    float damageAlpha = damageRing * 0.65 + edgeDistort;

    // Final
    vec3 color = baseColor + damageColor;
    float alpha = baseAlpha + damageAlpha;

    // Grain noise for texture
    float grain = fract(sin(dot(uv * uTime * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
    alpha += grain * 0.015;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.85));
}
`;

export class PostFX {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.ShaderMaterial;
  private damageAmount = 0;

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
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
  }
}
