import * as THREE from 'three';

// ── Weather types (must match server) ──
export const WEATHER_CLEAR = 0;
export const WEATHER_CLOUDY = 1;
export const WEATHER_OVERCAST = 2;
export const WEATHER_RAINY = 3;
export const WEATHER_STORMY = 4;

export const WEATHER_NAMES = ['Clear', 'Cloudy', 'Overcast', 'Rainy', 'Stormy'] as const;

// ── Environment state from server ──
export interface EnvironmentState {
  timeOfDay: number;    // 0-24
  weather: number;      // 0-4
  windSpeed: number;    // 0-1
  cloudDensity: number; // 0-1
  fogDensity: number;   // 0.5-2.0
}

// ── Sky gradient colors for different times of day ──
interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().lerpColors(a, b, t);
}

function getSkyColors(hour: number, weather: number): SkyColors {
  // Base sky colors by time of day
  const t = hour;

  let zenith: THREE.Color;
  let horizon: THREE.Color;
  let sun: THREE.Color;
  let sunIntensity: number;
  let ambient: THREE.Color;
  let ambientIntensity: number;
  let fog: THREE.Color;
  let hemiSky: THREE.Color;
  let hemiGround: THREE.Color;

  if (t < 5) {
    // Night (0-5)
    zenith = new THREE.Color(0x1b2344);
    horizon = new THREE.Color(0x29355a);
    sun = new THREE.Color(0x9bb4ff);
    sunIntensity = 0.1;
    ambient = new THREE.Color(0x556796);
    ambientIntensity = 0.72;
    fog = new THREE.Color(0x212b47);
    hemiSky = new THREE.Color(0x3d4f7c);
    hemiGround = new THREE.Color(0x1d2437);
  } else if (t < 6.5) {
    // Pre-dawn (5-6.5)
    const f = (t - 5) / 1.5;
    zenith = lerpColor(new THREE.Color(0x1b2344), new THREE.Color(0x1a1a3a), f);
    horizon = lerpColor(new THREE.Color(0x29355a), new THREE.Color(0x553322), f);
    sun = lerpColor(new THREE.Color(0x9bb4ff), new THREE.Color(0xdd6633), f);
    sunIntensity = 0.1 + f * 0.5;
    ambient = lerpColor(new THREE.Color(0x556796), new THREE.Color(0x2a1a15), f);
    ambientIntensity = 0.72 - f * 0.18;
    fog = lerpColor(new THREE.Color(0x212b47), new THREE.Color(0x3a2a22), f);
    hemiSky = lerpColor(new THREE.Color(0x3d4f7c), new THREE.Color(0x4a3040), f);
    hemiGround = lerpColor(new THREE.Color(0x1d2437), new THREE.Color(0x1a1510), f);
  } else if (t < 8) {
    // Dawn/sunrise (6.5-8)
    const f = (t - 6.5) / 1.5;
    zenith = lerpColor(new THREE.Color(0x1a1a3a), new THREE.Color(0x3366aa), f);
    horizon = lerpColor(new THREE.Color(0x553322), new THREE.Color(0xffaa55), f);
    sun = lerpColor(new THREE.Color(0xdd6633), new THREE.Color(0xffcc88), f);
    sunIntensity = 0.6 + f * 1.2;
    ambient = lerpColor(new THREE.Color(0x2a1a15), new THREE.Color(0x556688), f);
    ambientIntensity = 0.35 + f * 0.2;
    fog = lerpColor(new THREE.Color(0x3a2a22), new THREE.Color(0x88776a), f);
    hemiSky = lerpColor(new THREE.Color(0x4a3040), new THREE.Color(0x7788aa), f);
    hemiGround = lerpColor(new THREE.Color(0x1a1510), new THREE.Color(0x2a2218), f);
  } else if (t < 11) {
    // Morning (8-11)
    const f = (t - 8) / 3;
    zenith = lerpColor(new THREE.Color(0x3366aa), new THREE.Color(0x4488cc), f);
    horizon = lerpColor(new THREE.Color(0xffaa55), new THREE.Color(0x99bbdd), f);
    sun = lerpColor(new THREE.Color(0xffcc88), new THREE.Color(0xfff0d0), f);
    sunIntensity = 1.8 + f * 0.7;
    ambient = lerpColor(new THREE.Color(0x556688), new THREE.Color(0x606878), f);
    ambientIntensity = 0.55 + f * 0.1;
    fog = lerpColor(new THREE.Color(0x88776a), new THREE.Color(0x8899aa), f);
    hemiSky = lerpColor(new THREE.Color(0x7788aa), new THREE.Color(0x8a8a95), f);
    hemiGround = lerpColor(new THREE.Color(0x2a2218), new THREE.Color(0x2a2218), f);
  } else if (t < 16) {
    // Midday (11-16)
    zenith = new THREE.Color(0x4488cc);
    horizon = new THREE.Color(0x99bbdd);
    sun = new THREE.Color(0xfff0d0);
    sunIntensity = 2.5;
    ambient = new THREE.Color(0x606878);
    ambientIntensity = 0.65;
    fog = new THREE.Color(0x8899aa);
    hemiSky = new THREE.Color(0x8a8a95);
    hemiGround = new THREE.Color(0x2a2218);
  } else if (t < 18) {
    // Afternoon → sunset (16-18)
    const f = (t - 16) / 2;
    zenith = lerpColor(new THREE.Color(0x4488cc), new THREE.Color(0x2244aa), f);
    horizon = lerpColor(new THREE.Color(0x99bbdd), new THREE.Color(0xff7733), f);
    sun = lerpColor(new THREE.Color(0xfff0d0), new THREE.Color(0xff8844), f);
    sunIntensity = 2.5 - f * 1.2;
    ambient = lerpColor(new THREE.Color(0x606878), new THREE.Color(0x3a2520), f);
    ambientIntensity = 0.65 - f * 0.25;
    fog = lerpColor(new THREE.Color(0x8899aa), new THREE.Color(0x664433), f);
    hemiSky = lerpColor(new THREE.Color(0x8a8a95), new THREE.Color(0x553344), f);
    hemiGround = lerpColor(new THREE.Color(0x2a2218), new THREE.Color(0x1a1510), f);
  } else if (t < 19.5) {
    // Dusk (18-19.5)
    const f = (t - 18) / 1.5;
    zenith = lerpColor(new THREE.Color(0x2244aa), new THREE.Color(0x1b2344), f);
    horizon = lerpColor(new THREE.Color(0xff7733), new THREE.Color(0x29355a), f);
    sun = lerpColor(new THREE.Color(0xff8844), new THREE.Color(0x9bb4ff), f);
    sunIntensity = 1.3 - f * 1.0;
    ambient = lerpColor(new THREE.Color(0x3a2520), new THREE.Color(0x556796), f);
    ambientIntensity = 0.4 + f * 0.32;
    fog = lerpColor(new THREE.Color(0x664433), new THREE.Color(0x212b47), f);
    hemiSky = lerpColor(new THREE.Color(0x553344), new THREE.Color(0x3d4f7c), f);
    hemiGround = lerpColor(new THREE.Color(0x1a1510), new THREE.Color(0x1d2437), f);
  } else {
    // Night (19.5-24)
    zenith = new THREE.Color(0x1b2344);
    horizon = new THREE.Color(0x29355a);
    sun = new THREE.Color(0x9bb4ff);
    sunIntensity = 0.1;
    ambient = new THREE.Color(0x556796);
    ambientIntensity = 0.72;
    fog = new THREE.Color(0x212b47);
    hemiSky = new THREE.Color(0x3d4f7c);
    hemiGround = new THREE.Color(0x1d2437);
  }

  // Weather modifiers
  if (weather >= WEATHER_CLOUDY) {
    const weatherDim = weather === WEATHER_CLOUDY ? 0.15 : weather === WEATHER_OVERCAST ? 0.35 : weather === WEATHER_RAINY ? 0.45 : 0.6;
    const gray = new THREE.Color(0x555560);
    const darkGray = new THREE.Color(0x333338);

    zenith = lerpColor(zenith, darkGray, weatherDim);
    horizon = lerpColor(horizon, gray, weatherDim);
    sunIntensity *= (1 - weatherDim * 0.8);
    ambientIntensity *= (1 + weatherDim * 0.22);
    fog = lerpColor(fog, gray, weatherDim * 0.6);
    hemiSky = lerpColor(hemiSky, gray, weatherDim * 0.5);
  }

  return { zenith, horizon, sun, sunIntensity, ambient, ambientIntensity, fog, hemiSky, hemiGround };
}

// ── Sky dome shader ──
const skyVertexShader = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragmentShader = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColor;
uniform float uSunSize;
uniform float uCloudDensity;
uniform float uTime;
uniform float uStarVisibility;
uniform float uMoonVisibility;

varying vec3 vWorldPosition;

// Simple noise for clouds
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// Stars
float starField(vec3 dir) {
  vec2 uv = vec2(
    atan(dir.x, dir.z) / 6.28318530718 + 0.5,
    asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5
  );
  uv *= vec2(220.0, 110.0);

  vec2 cell = floor(uv);
  vec2 local = fract(uv) - 0.5;
  float h = hash(cell);
  float starMask = step(0.9975, h);
  vec2 offset = vec2(hash(cell + 11.7), hash(cell + 27.1)) - 0.5;
  vec2 p = local - offset * 0.35;
  float dist = length(vec2(p.x, p.y * 1.4));
  float star = smoothstep(0.12, 0.0, dist) * starMask;
  star *= 0.55 + 0.45 * sin(uTime * 1.6 + h * 120.0);
  return star;
}

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float y = dir.y;

  // Sky gradient (horizon to zenith)
  float horizonFade = smoothstep(-0.05, 0.4, y);
  vec3 skyColor = mix(uHorizon, uZenith, horizonFade);

  // Sun disc + glow
  float sunDot = max(dot(dir, uSunDirection), 0.0);
  float sunDisc = smoothstep(1.0 - uSunSize * 0.0003, 1.0 - uSunSize * 0.0001, sunDot);
  float sunGlow = pow(sunDot, 16.0) * 0.5;
  float sunHalo = pow(sunDot, 4.0) * 0.15;
  skyColor += uSunColor * (sunDisc * 3.0 + sunGlow + sunHalo);

  // Moon (opposite side of sun, visible at night only)
  if (uMoonVisibility > 0.01) {
    float moonDot = max(dot(dir, normalize(uMoonDirection)), 0.0);
    float moonDisc = smoothstep(0.999, 0.9995, moonDot);
    float moonGlow = pow(moonDot, 32.0) * 0.08;
    skyColor += uMoonColor * (moonDisc * 1.5 + moonGlow) * (1.0 - sunDisc) * uMoonVisibility;
  }

  // Stars (visible at night)
  if (uStarVisibility > 0.01) {
    float stars = starField(dir) * uStarVisibility;
    skyColor += vec3(stars);
  }

  // Clouds
  if (uCloudDensity > 0.05 && y > -0.1) {
    vec2 cloudUV = dir.xz / (y + 0.3) * 3.0;
    cloudUV += uTime * 0.005;
    float cloud = fbm(cloudUV);
    float threshold = 1.0 - uCloudDensity;
    cloud = smoothstep(threshold, threshold + 0.3, cloud);
    // Cloud lit by sun color from below
    vec3 cloudColor = mix(vec3(0.5, 0.5, 0.55), uSunColor * 0.6 + vec3(0.4), max(sunDot, 0.0) * 0.3 + 0.3);
    // Darken clouds in bad weather
    cloudColor *= mix(1.0, 0.5, smoothstep(0.5, 0.9, uCloudDensity));
    skyColor = mix(skyColor, cloudColor, cloud * 0.7);
  }

  // Fade near horizon for fog blending
  float fogBlend = smoothstep(0.1, -0.05, y);
  skyColor = mix(skyColor, uHorizon, fogBlend * 0.5);

  gl_FragColor = vec4(skyColor, 1.0);
}
`;

// ── Rain system ──
const RAIN_COUNT = 3000;

const rainVertexShader = `
attribute float size;
attribute float speed;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
varying float vAlpha;

void main() {
  vec3 pos = position;

  // Animate: rain falls and wraps
  float t = mod(uTime * speed + pos.y, 60.0) - 30.0;
  pos.y = t;
  pos.x += uWindX * (30.0 - t) * 0.05;
  pos.z += uWindZ * (30.0 - t) * 0.05;

  // Position relative to camera
  pos += cameraPosition;
  pos.x = mod(pos.x + 30.0, 60.0) - 30.0 + cameraPosition.x;
  pos.z = mod(pos.z + 30.0, 60.0) - 30.0 + cameraPosition.z;

  vAlpha = smoothstep(-30.0, -20.0, t) * smoothstep(30.0, 20.0, t);
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = size * (100.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const rainFragmentShader = `
varying float vAlpha;
uniform vec3 uRainColor;

void main() {
  // Elongated raindrop shape
  vec2 center = gl_PointCoord - 0.5;
  float d = length(center * vec2(3.0, 1.0));
  if (d > 0.5) discard;
  float alpha = (1.0 - d * 2.0) * vAlpha * 0.4;
  gl_FragColor = vec4(uRainColor, alpha);
}
`;

export class SkySystem {
  private skyMesh: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;

  // Rain
  private rainMesh: THREE.Points | null = null;
  private rainMaterial: THREE.ShaderMaterial | null = null;

  // Lighting references (Engine passes these in)
  private sunLight: THREE.DirectionalLight;
  private moonLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;

  // Current state (smoothly interpolated)
  private currentEnv: EnvironmentState = {
    timeOfDay: 12, weather: 0, windSpeed: 0.2, cloudDensity: 0.2, fogDensity: 0.8,
  };
  private targetEnv: EnvironmentState = { ...this.currentEnv };

  // Scene references
  private scene: THREE.Scene;
  private elapsedTime = 0;
  private exposure = 1.1;
  private sunVisibility = 1;
  private moonVisibility = 0;
  private moonColor = new THREE.Color(0.62, 0.72, 0.95);

  // Reusable vectors
  private sunDir = new THREE.Vector3();
  private moonDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    sunLight: THREE.DirectionalLight,
    moonLight: THREE.DirectionalLight,
    hemiLight: THREE.HemisphereLight,
    ambientLight: THREE.AmbientLight,
  ) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.moonLight = moonLight;
    this.hemiLight = hemiLight;
    this.ambientLight = ambientLight;

    // Create sky dome
    const skyGeo = new THREE.SphereGeometry(250, 32, 16);
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      uniforms: {
        uZenith: { value: new THREE.Color(0x4488cc) },
        uHorizon: { value: new THREE.Color(0x99bbdd) },
        uSunColor: { value: new THREE.Color(0xfff0d0) },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
        uMoonDirection: { value: new THREE.Vector3(-0.25, 0.6, -0.2).normalize() },
        uMoonColor: { value: new THREE.Color(0.62, 0.72, 0.95) },
        uSunSize: { value: 1.0 },
        uCloudDensity: { value: 0.3 },
        uTime: { value: 0 },
        uStarVisibility: { value: 0 },
        uMoonVisibility: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.renderOrder = -1;
    this.skyMesh.frustumCulled = false;
    scene.add(this.skyMesh);
  }

  /** Update target environment from server data */
  setEnvironment(env: EnvironmentState): void {
    this.targetEnv = { ...env };
  }

  /** Create rain particles (call when weather becomes rainy/stormy) */
  private createRain(): void {
    if (this.rainMesh) return;

    const positions = new Float32Array(RAIN_COUNT * 3);
    const sizes = new Float32Array(RAIN_COUNT);
    const speeds = new Float32Array(RAIN_COUNT);

    for (let i = 0; i < RAIN_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
      sizes[i] = 2 + Math.random() * 3;
      speeds[i] = 8 + Math.random() * 12;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

    this.rainMaterial = new THREE.ShaderMaterial({
      vertexShader: rainVertexShader,
      fragmentShader: rainFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWindX: { value: 0.5 },
        uWindZ: { value: 0.3 },
        uRainColor: { value: new THREE.Color(0.6, 0.65, 0.75) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.rainMesh = new THREE.Points(geo, this.rainMaterial);
    this.rainMesh.frustumCulled = false;
    this.scene.add(this.rainMesh);
  }

  /** Remove rain particles */
  private removeRain(): void {
    if (this.rainMesh) {
      this.scene.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
      this.rainMaterial?.dispose();
      this.rainMesh = null;
      this.rainMaterial = null;
    }
  }

  /** Main update — call each frame */
  update(delta: number, cameraPosition?: THREE.Vector3): void {
    // Keep sky dome centered on camera so edges are never clipped
    if (cameraPosition) {
      this.skyMesh.position.copy(cameraPosition);
    }
    this.elapsedTime += delta;

    // Smooth interpolation toward target
    const lerpSpeed = 0.5 * delta;
    this.currentEnv.timeOfDay = this.lerpAngle24(this.currentEnv.timeOfDay, this.targetEnv.timeOfDay, lerpSpeed);
    this.currentEnv.weather = this.targetEnv.weather; // snap weather type
    this.currentEnv.windSpeed += (this.targetEnv.windSpeed - this.currentEnv.windSpeed) * lerpSpeed * 2;
    this.currentEnv.cloudDensity += (this.targetEnv.cloudDensity - this.currentEnv.cloudDensity) * lerpSpeed * 2;
    this.currentEnv.fogDensity += (this.targetEnv.fogDensity - this.currentEnv.fogDensity) * lerpSpeed * 2;

    const colors = getSkyColors(this.currentEnv.timeOfDay, this.currentEnv.weather);

    // Update sky shader
    this.skyMaterial.uniforms.uZenith.value.copy(colors.zenith);
    this.skyMaterial.uniforms.uHorizon.value.copy(colors.horizon);
    this.skyMaterial.uniforms.uSunColor.value.copy(colors.sun);
    this.skyMaterial.uniforms.uMoonColor.value.copy(this.moonColor);
    this.skyMaterial.uniforms.uCloudDensity.value = this.currentEnv.cloudDensity;
    this.skyMaterial.uniforms.uTime.value = this.elapsedTime;

    // Sun/Moon positions: stable orbital model (prevents inverted sunrise/sunset)
    const solarPhase = ((this.currentEnv.timeOfDay - 6) / 24) * Math.PI * 2;
    const elevation = Math.sin(solarPhase);
    const azimuth = solarPhase * 0.35 + Math.PI * 0.15;
    const horizontalRadius = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const sunDir = this.sunDir.set(
      Math.cos(azimuth) * horizontalRadius,
      elevation,
      Math.sin(azimuth) * horizontalRadius,
    ).normalize();
    const moonDir = this.moonDir.copy(sunDir).multiplyScalar(-1);
    this.skyMaterial.uniforms.uSunDirection.value.copy(sunDir);
    this.skyMaterial.uniforms.uMoonDirection.value.copy(moonDir);

    // Day/night factors
    const sunAboveHorizon = clamp01((sunDir.y + 0.05) / 0.25);
    const nightFactor = 1 - sunAboveHorizon;
    const moonAboveHorizon = clamp01((moonDir.y + 0.03) / 0.2);
    const moonVisibility = nightFactor * moonAboveHorizon;
    this.sunVisibility = sunAboveHorizon;
    this.moonVisibility = moonVisibility;
    this.skyMaterial.uniforms.uStarVisibility.value = nightFactor;
    this.skyMaterial.uniforms.uMoonVisibility.value = moonVisibility;

    // Update directional light (sun) — must follow camera so shadows stay around player,
    // and direction must match the visual sun in the sky shader
    this.sunLight.color.copy(colors.sun);
    this.sunLight.intensity = colors.sunIntensity * sunAboveHorizon;

    if (cameraPosition) {
      // Light shines FROM sun direction toward camera — shadows match visual sun
      this.sunLight.position.set(
        cameraPosition.x + sunDir.x * 80,
        cameraPosition.y + Math.max(sunDir.y * 80, 5),
        cameraPosition.z + sunDir.z * 80,
      );
      this.sunLight.target.position.copy(cameraPosition);
      this.sunLight.target.updateMatrixWorld();

      // Snap shadow camera to texel grid to prevent swimming/flickering
      this.stabilizeShadows(sunDir);
    } else {
      this.sunLight.position.set(sunDir.x * 80, Math.max(sunDir.y * 80, 5), sunDir.z * 80);
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.target.updateMatrixWorld();
    }

    // Moon light gives readable contrast for competitive nighttime gameplay
    this.moonLight.color.copy(this.moonColor);
    this.moonLight.intensity = 0.4 + moonVisibility * 1.1;
    if (cameraPosition) {
      this.moonLight.position.set(
        cameraPosition.x + moonDir.x * 90,
        cameraPosition.y + Math.max(moonDir.y * 90, 8),
        cameraPosition.z + moonDir.z * 90,
      );
      this.moonLight.target.position.copy(cameraPosition);
      this.moonLight.target.updateMatrixWorld();
    } else {
      this.moonLight.position.set(moonDir.x * 90, Math.max(moonDir.y * 90, 8), moonDir.z * 90);
      this.moonLight.target.position.set(0, 0, 0);
      this.moonLight.target.updateMatrixWorld();
    }

    // Hemisphere light
    this.hemiLight.color.copy(colors.hemiSky);
    this.hemiLight.groundColor.copy(colors.hemiGround);
    this.hemiLight.intensity = Math.max(0.95, 0.78 + colors.ambientIntensity * 0.56);

    // Ambient light
    this.ambientLight.color.copy(colors.ambient);
    this.ambientLight.intensity = Math.max(colors.ambientIntensity, 0.7 + nightFactor * 0.28);

    // Renderer exposure target (higher floor at night to prevent black crush)
    const weatherPenalty = clamp01(this.currentEnv.cloudDensity * 0.22);
    this.exposure = 1.15 + nightFactor * 0.72 - weatherPenalty * 0.75;

    // Fog
    const fogColor = colors.fog;
    if (this.scene.fog instanceof THREE.Fog) {
      (this.scene.fog as THREE.Fog).color.copy(fogColor);
      // Adjust fog distance based on weather
      const baseFar = 150;
      const baseNear = 40;
      (this.scene.fog as THREE.Fog).far = baseFar / this.currentEnv.fogDensity;
      (this.scene.fog as THREE.Fog).near = baseNear / this.currentEnv.fogDensity;
    }

    // Renderer clear color should match fog
    // (Engine will read this via getClearColor)

    // Rain
    const isRaining = this.currentEnv.weather >= WEATHER_RAINY;
    if (isRaining && !this.rainMesh) {
      this.createRain();
    } else if (!isRaining && this.rainMesh) {
      this.removeRain();
    }

    if (this.rainMesh && this.rainMaterial) {
      this.rainMaterial.uniforms.uTime.value = this.elapsedTime;
      this.rainMaterial.uniforms.uWindX.value = this.currentEnv.windSpeed * 2 - 0.5;
      this.rainMaterial.uniforms.uWindZ.value = this.currentEnv.windSpeed - 0.3;
      // More rain in stormy weather
      this.rainMesh.visible = true;
    }
  }

  /** Get current fog color for renderer clear color */
  getFogColor(): THREE.Color {
    const colors = getSkyColors(this.currentEnv.timeOfDay, this.currentEnv.weather);
    return colors.fog;
  }

  /** Get display info for HUD */
  getTimeString(): string {
    const h = Math.floor(this.currentEnv.timeOfDay);
    const m = Math.floor((this.currentEnv.timeOfDay - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  getWeatherName(): string {
    return WEATHER_NAMES[this.currentEnv.weather] || 'Unknown';
  }

  getSunDirection(): THREE.Vector3 {
    return this.skyMaterial.uniforms.uSunDirection.value;
  }

  getSunColor(): THREE.Color {
    return this.skyMaterial.uniforms.uSunColor.value;
  }

  getMoonDirection(): THREE.Vector3 {
    return this.skyMaterial.uniforms.uMoonDirection.value;
  }

  getMoonColor(): THREE.Color {
    return this.moonColor;
  }

  getSunVisibility(): number {
    return this.sunVisibility;
  }

  getMoonVisibility(): number {
    return this.moonVisibility;
  }

  getExposure(): number {
    return this.exposure;
  }

  // Reusable vectors for shadow stabilization (avoid per-frame allocations)
  private _shadowRight = new THREE.Vector3();
  private _shadowUp = new THREE.Vector3();

  /**
   * Snap shadow camera position to texel boundaries so the shadow map
   * stays grid-aligned as the camera moves. Prevents shadow swimming/flickering.
   */
  private stabilizeShadows(lightDir: THREE.Vector3): void {
    const shadowCam = this.sunLight.shadow.camera;
    const mapSize = this.sunLight.shadow.mapSize.x;
    const frustumWidth = shadowCam.right - shadowCam.left;
    const texelSize = frustumWidth / mapSize;

    // Build shadow camera's right/up axes from the light direction
    const worldUp = Math.abs(lightDir.y) > 0.99
      ? this._shadowRight.set(1, 0, 0)
      : this._shadowRight.set(0, 1, 0);
    const right = this._shadowRight.crossVectors(worldUp, lightDir).normalize();
    const up = this._shadowUp.crossVectors(lightDir, right).normalize();

    // Project target onto shadow plane axes
    const target = this.sunLight.target.position;
    const projR = target.dot(right);
    const projU = target.dot(up);

    // Snap to nearest texel
    const snapR = Math.round(projR / texelSize) * texelSize - projR;
    const snapU = Math.round(projU / texelSize) * texelSize - projU;

    // Shift both light and target by the snap offset
    this.sunLight.position.addScaledVector(right, snapR);
    this.sunLight.position.addScaledVector(up, snapU);
    target.addScaledVector(right, snapR);
    target.addScaledVector(up, snapU);
  }

  /** Lerp in 24h circular space */
  private lerpAngle24(a: number, b: number, t: number): number {
    let diff = b - a;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    let result = a + diff * t;
    if (result < 0) result += 24;
    if (result >= 24) result -= 24;
    return result;
  }

  dispose(): void {
    this.scene.remove(this.skyMesh);
    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose();
    this.removeRain();
  }
}
