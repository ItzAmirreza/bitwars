import * as THREE from 'three';

/**
 * Post-processing pipeline:
 *  1. Scene rendered to offscreen RT (by Engine)
 *  2. Extract bright celestial pixels → occlusion mask (quarter res)
 *  3. Radial blur from active celestial screen pos → god rays (quarter res)
 *  4. Composite: scene + god rays + glare + vignette/damage/grain → screen
 *
 * God ray technique from GPU Gems 3, Chapter 13 — "Volumetric Light Scattering"
 */

// ── Shared vertex shader ──

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

interface CelestialLightSource {
  direction: THREE.Vector3;
  color: THREE.Color;
  visibility: number;
  godRayIntensity?: number;
  glareIntensity?: number;
}

// ── Pass 1: Extract bright pixels near the active light source ──

const OCCLUSION_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uLightPos;
uniform float uLightVisibility;
uniform vec2 uInvResolution;
varying vec2 vUv;

float luminance(vec3 col) {
    return dot(col, vec3(0.2126, 0.7152, 0.0722));
}

float sampleSourceVisibility(vec2 pos) {
    vec2 p = clamp(pos, vec2(0.001), vec2(0.999));
    vec2 dx = vec2(uInvResolution.x * 6.0, 0.0);
    vec2 dy = vec2(0.0, uInvResolution.y * 6.0);
    vec2 d1 = vec2(uInvResolution.x * 4.0, uInvResolution.y * 4.0);
    vec2 d2 = vec2(uInvResolution.x * 4.0, -uInvResolution.y * 4.0);

    float center = luminance(texture2D(tScene, p).rgb);
    float sampleX1 = luminance(texture2D(tScene, clamp(p + dx, 0.001, 0.999)).rgb);
    float sampleX2 = luminance(texture2D(tScene, clamp(p - dx, 0.001, 0.999)).rgb);
    float sampleY1 = luminance(texture2D(tScene, clamp(p + dy, 0.001, 0.999)).rgb);
    float sampleY2 = luminance(texture2D(tScene, clamp(p - dy, 0.001, 0.999)).rgb);
    float sampleD1 = luminance(texture2D(tScene, clamp(p + d1, 0.001, 0.999)).rgb);
    float sampleD2 = luminance(texture2D(tScene, clamp(p - d1, 0.001, 0.999)).rgb);
    float sampleD3 = luminance(texture2D(tScene, clamp(p + d2, 0.001, 0.999)).rgb);
    float sampleD4 = luminance(texture2D(tScene, clamp(p - d2, 0.001, 0.999)).rgb);

    float peak = max(center, max(max(sampleX1, sampleX2), max(sampleY1, sampleY2)));
    peak = max(peak, max(max(sampleD1, sampleD2), max(sampleD3, sampleD4)));
    return smoothstep(0.08, 0.32, peak);
}

void main() {
    vec3 col = texture2D(tScene, vUv).rgb;
    float lum = luminance(col);
    float sourceVisible = sampleSourceVisibility(uLightPos);

    // Extract bright pixels (sun disc + bright sky)
    float bright = max(0.0, lum - 0.65) * 1.5;

    // Weight by proximity to sun — further pixels contribute less
    float lightDist = length(vUv - uLightPos);
    float lightMask = smoothstep(0.5, 0.0, lightDist);

    // Direct glow only when the source itself is actually visible
    float glow = exp(-lightDist * lightDist * 10.0) * 0.36 * sourceVisible;

    float result = (bright * lightMask + glow) * uLightVisibility;
    gl_FragColor = vec4(vec3(result), 1.0);
}
`;

// ── Pass 2: Radial blur from active light screen position ──

const GODRAYS_FRAG = /* glsl */ `
uniform sampler2D tOcclusion;
uniform vec2 uLightPos;
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
uniform float uExposure;
varying vec2 vUv;

#define SAMPLES 80

void main() {
    vec2 deltaUV = (vUv - uLightPos) * uDensity / float(SAMPLES);
    vec2 uv = vUv;
    float illum = 0.0;
    float w = uWeight;

    for (int i = 0; i < SAMPLES; i++) {
        uv -= deltaUV;
        illum += texture2D(tOcclusion, clamp(uv, 0.001, 0.999)).r * w;
        w *= uDecay;
    }

    gl_FragColor = vec4(vec3(illum * uExposure), 1.0);
}
`;

// ── Pass 3: Final composite ──

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tGodRays;
uniform float uGodRayIntensity;
uniform vec3 uLightColor;
uniform float uLightVisibility;
uniform vec2 uLightPos;
uniform vec2 uInvResolution;
uniform float uDamage;
uniform float uTime;
uniform float uExposureBoost;
varying vec2 vUv;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float luminance(vec3 col) {
    return dot(col, vec3(0.2126, 0.7152, 0.0722));
}

float sampleSourceVisibility(sampler2D tex, vec2 pos) {
    vec2 p = clamp(pos, vec2(0.001), vec2(0.999));
    vec2 dx = vec2(uInvResolution.x * 6.0, 0.0);
    vec2 dy = vec2(0.0, uInvResolution.y * 6.0);
    vec2 d1 = vec2(uInvResolution.x * 4.0, uInvResolution.y * 4.0);
    vec2 d2 = vec2(uInvResolution.x * 4.0, -uInvResolution.y * 4.0);

    float center = luminance(texture2D(tex, p).rgb);
    float sampleX1 = luminance(texture2D(tex, clamp(p + dx, 0.001, 0.999)).rgb);
    float sampleX2 = luminance(texture2D(tex, clamp(p - dx, 0.001, 0.999)).rgb);
    float sampleY1 = luminance(texture2D(tex, clamp(p + dy, 0.001, 0.999)).rgb);
    float sampleY2 = luminance(texture2D(tex, clamp(p - dy, 0.001, 0.999)).rgb);
    float sampleD1 = luminance(texture2D(tex, clamp(p + d1, 0.001, 0.999)).rgb);
    float sampleD2 = luminance(texture2D(tex, clamp(p - d1, 0.001, 0.999)).rgb);
    float sampleD3 = luminance(texture2D(tex, clamp(p + d2, 0.001, 0.999)).rgb);
    float sampleD4 = luminance(texture2D(tex, clamp(p - d2, 0.001, 0.999)).rgb);

    float peak = max(center, max(max(sampleX1, sampleX2), max(sampleY1, sampleY2)));
    peak = max(peak, max(max(sampleD1, sampleD2), max(sampleD3, sampleD4)));
    return smoothstep(0.08, 0.32, peak);
}

void main() {
    vec3 scene = texture2D(tScene, vUv).rgb;
    float rays = texture2D(tGodRays, vUv).r;
    float sourceVisible = sampleSourceVisibility(tScene, uLightPos);

    // God rays with active celestial tint
    vec3 color = scene + rays * uLightColor * uGodRayIntensity * sourceVisible;

    // Glare — bright wash when looking directly at the active light
    float lightDist = length(vUv - uLightPos);
    float glare = exp(-lightDist * lightDist * 3.0) * uExposureBoost * uLightVisibility * pow(sourceVisible, 0.8);
    color += uLightColor * glare * 0.4;

    // Subtle overall brightening when facing sun
    color *= 1.0 + uExposureBoost * 0.15 * sourceVisible;

    // ── Warzone vignette ──
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;
    float vignette = smoothstep(0.5, 1.6, dist);
    color *= 1.0 - vignette * 0.25;
    color += vec3(0.03, 0.02, 0.01) * vignette * 0.1;

    // ── Very subtle atmospheric lift ──
    float haze = 0.0015 + 0.001 * sin(uTime * 0.18 + vUv.x * 2.0) * cos(uTime * 0.14 + vUv.y * 1.5);
    color += vec3(0.08, 0.07, 0.05) * haze;

    // ── Damage red pulse ──
    float pulse = 0.7 + 0.3 * sin(uTime * 20.0);
    float damageRing = smoothstep(0.1, 0.85, dist) * uDamage * pulse;
    float warp = uDamage * 0.015 * dist;
    vec2 warpedUv = center * (1.0 + warp) + 0.5;
    float warpDist = length(warpedUv - 0.5) * 2.0;
    float edgeDistort = smoothstep(0.5, 1.0, warpDist) * uDamage * 0.35;
    color += vec3(0.95, 0.05, 0.0) * (damageRing * 0.7 + edgeDistort);

    // Keep the image clean; only a tiny bit of noise remains during damage
    float grain = (hash(vUv * 320.0 + fract(uTime * 5.0)) - 0.5) * 0.008 * uDamage;
    color += grain;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ── Simple blit (when PostFX disabled) ──

const BLIT_FRAG = /* glsl */ `
uniform sampler2D tScene;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tScene, vUv); }
`;

export class PostFX {
  // Render targets
  private sceneRT: THREE.WebGLRenderTarget;
  private occlusionRT: THREE.WebGLRenderTarget;
  private godRaysRT: THREE.WebGLRenderTarget;

  // Shader materials
  private occlusionMat: THREE.ShaderMaterial;
  private godRaysMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private blitMat: THREE.ShaderMaterial;

  // Full-screen quad
  private orthoScene: THREE.Scene;
  private orthoCam: THREE.OrthographicCamera;
  private quad: THREE.Mesh;

  // State
  private damageAmount = 0;
  private lightScreenPos = new THREE.Vector2(0.5, 0.7);
  private lightVisibility = 0;
  private lightColor = new THREE.Color(1.0, 0.9, 0.7);
  private exposureBoost = 0;
  private godRayIntensity = 1.2;

  enabled = true;

  constructor(width: number, height: number) {
    // Full-res scene target (HalfFloat for better precision in bright-pass extraction)
    this.sceneRT = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Quarter-res for god ray passes (cheap)
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));

    this.occlusionRT = new THREE.WebGLRenderTarget(qw, qh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    this.godRaysRT = new THREE.WebGLRenderTarget(qw, qh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // ── Materials ──

    this.occlusionMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: OCCLUSION_FRAG,
      uniforms: {
        tScene: { value: null },
        uLightPos: { value: new THREE.Vector2(0.5, 0.7) },
        uLightVisibility: { value: 0 },
        uInvResolution: { value: new THREE.Vector2(1 / width, 1 / height) },
      },
      depthTest: false, depthWrite: false, toneMapped: false,
    });

    this.godRaysMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: GODRAYS_FRAG,
      uniforms: {
        tOcclusion: { value: null },
        uLightPos: { value: new THREE.Vector2(0.5, 0.7) },
        uDensity: { value: 0.96 },
        uDecay: { value: 0.97 },
        uWeight: { value: 0.04 },
        uExposure: { value: 0.9 },
      },
      depthTest: false, depthWrite: false, toneMapped: false,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null },
        tGodRays: { value: null },
        uGodRayIntensity: { value: 1.2 },
        uLightColor: { value: new THREE.Color(1.0, 0.9, 0.7) },
        uLightVisibility: { value: 0 },
        uLightPos: { value: new THREE.Vector2(0.5, 0.7) },
        uInvResolution: { value: new THREE.Vector2(1 / width, 1 / height) },
        uDamage: { value: 0 },
        uTime: { value: 0 },
        uExposureBoost: { value: 0 },
      },
      depthTest: false, depthWrite: false, toneMapped: false,
    });

    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: { tScene: { value: null } },
      depthTest: false, depthWrite: false, toneMapped: false,
    });

    // Full-screen quad in ortho scene
    this.orthoScene = new THREE.Scene();
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
    this.orthoScene.add(this.quad);
  }

  /** Engine renders the scene into this RT */
  getRenderTarget(): THREE.WebGLRenderTarget {
    return this.sceneRT;
  }

  resize(width: number, height: number): void {
    this.sceneRT.setSize(width, height);
    const qw = Math.max(1, Math.floor(width / 4));
    const qh = Math.max(1, Math.floor(height / 4));
    this.occlusionRT.setSize(qw, qh);
    this.godRaysRT.setSize(qw, qh);
    this.occlusionMat.uniforms.uInvResolution.value.set(1 / width, 1 / height);
    this.compositeMat.uniforms.uInvResolution.value.set(1 / width, 1 / height);
  }

  // Reusable vectors
  private _camFwd = new THREE.Vector3();
  private _lightWorld = new THREE.Vector3();

  /** Call after camera effects are applied, before render */
  updateCelestial(camera: THREE.Camera, sources: CelestialLightSource[]): void {
    camera.getWorldDirection(this._camFwd);
    let bestSource: CelestialLightSource | null = null;
    let bestFacing = 0;
    let bestScore = 0;

    for (const source of sources) {
      if (source.visibility <= 0) continue;
      const facing = Math.max(0, source.direction.dot(this._camFwd));
      const score = source.visibility * Math.pow(facing, 1.5) * (source.godRayIntensity ?? 1);
      if (score > bestScore) {
        bestScore = score;
        bestFacing = facing;
        bestSource = source;
      }
    }

    if (!bestSource) {
      this.lightVisibility = 0;
      this.exposureBoost = 0;
      return;
    }

    this.lightVisibility = Math.min(1, bestSource.visibility * bestFacing);
    this.exposureBoost = Math.pow(bestFacing, 4) * (bestSource.glareIntensity ?? 0.8) * bestSource.visibility;
    this.godRayIntensity = bestSource.godRayIntensity ?? 1.2;
    this.lightColor.copy(bestSource.color);

    if (bestFacing > -0.2) {
      this._lightWorld.copy(camera.position).addScaledVector(bestSource.direction, 200);
      this._lightWorld.project(camera);
      this.lightScreenPos.set(
        this._lightWorld.x * 0.5 + 0.5,
        this._lightWorld.y * 0.5 + 0.5,
      );
    }
  }

  triggerDamage(intensity: number = 0.6): void {
    this.damageAmount = Math.min(1, this.damageAmount + intensity);
  }

  update(delta: number, elapsedTime: number): void {
    this.damageAmount = Math.max(0, this.damageAmount - delta * 2.0);

    // Push state to uniforms
    this.occlusionMat.uniforms.uLightPos.value.copy(this.lightScreenPos);
    this.occlusionMat.uniforms.uLightVisibility.value = this.lightVisibility;

    this.godRaysMat.uniforms.uLightPos.value.copy(this.lightScreenPos);

    this.compositeMat.uniforms.uDamage.value = this.damageAmount;
    this.compositeMat.uniforms.uTime.value = elapsedTime;
    this.compositeMat.uniforms.uGodRayIntensity.value = this.godRayIntensity;
    this.compositeMat.uniforms.uLightColor.value.copy(this.lightColor);
    this.compositeMat.uniforms.uLightVisibility.value = this.lightVisibility;
    this.compositeMat.uniforms.uLightPos.value.copy(this.lightScreenPos);
    this.compositeMat.uniforms.uExposureBoost.value = this.exposureBoost;
  }

  /** Run the full post-processing pipeline and output to screen */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.enabled) {
      this.quad.material = this.blitMat;
      this.blitMat.uniforms.tScene.value = this.sceneRT.texture;
      renderer.setRenderTarget(null);
      renderer.render(this.orthoScene, this.orthoCam);
      return;
    }

    // Pass 1 — bright-pixel extraction (quarter res)
    this.quad.material = this.occlusionMat;
    this.occlusionMat.uniforms.tScene.value = this.sceneRT.texture;
    renderer.setRenderTarget(this.occlusionRT);
    renderer.clear();
    renderer.render(this.orthoScene, this.orthoCam);

    // Pass 2 — radial blur → god rays (quarter res)
    this.quad.material = this.godRaysMat;
    this.godRaysMat.uniforms.tOcclusion.value = this.occlusionRT.texture;
    renderer.setRenderTarget(this.godRaysRT);
    renderer.clear();
    renderer.render(this.orthoScene, this.orthoCam);

    // Pass 3 — composite scene + god rays + FX → screen
    this.quad.material = this.compositeMat;
    this.compositeMat.uniforms.tScene.value = this.sceneRT.texture;
    this.compositeMat.uniforms.tGodRays.value = this.godRaysRT.texture;
    renderer.setRenderTarget(null);
    renderer.render(this.orthoScene, this.orthoCam);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.occlusionRT.dispose();
    this.godRaysRT.dispose();
    this.occlusionMat.dispose();
    this.godRaysMat.dispose();
    this.compositeMat.dispose();
    this.blitMat.dispose();
    this.quad.geometry.dispose();
  }
}
