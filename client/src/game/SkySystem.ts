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
    zenith = new THREE.Color(0x0a0a1a);
    horizon = new THREE.Color(0x111122);
    sun = new THREE.Color(0x334466);
    sunIntensity = 0.1;
    ambient = new THREE.Color(0x0a0a15);
    ambientIntensity = 0.15;
    fog = new THREE.Color(0x0d0d1a);
    hemiSky = new THREE.Color(0x111125);
    hemiGround = new THREE.Color(0x0a0a10);
  } else if (t < 6.5) {
    // Pre-dawn (5-6.5)
    const f = (t - 5) / 1.5;
    zenith = lerpColor(new THREE.Color(0x0a0a1a), new THREE.Color(0x1a1a3a), f);
    horizon = lerpColor(new THREE.Color(0x111122), new THREE.Color(0x553322), f);
    sun = lerpColor(new THREE.Color(0x334466), new THREE.Color(0xdd6633), f);
    sunIntensity = 0.1 + f * 0.5;
    ambient = lerpColor(new THREE.Color(0x0a0a15), new THREE.Color(0x2a1a15), f);
    ambientIntensity = 0.15 + f * 0.2;
    fog = lerpColor(new THREE.Color(0x0d0d1a), new THREE.Color(0x3a2a22), f);
    hemiSky = lerpColor(new THREE.Color(0x111125), new THREE.Color(0x4a3040), f);
    hemiGround = lerpColor(new THREE.Color(0x0a0a10), new THREE.Color(0x1a1510), f);
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
    zenith = lerpColor(new THREE.Color(0x2244aa), new THREE.Color(0x111133), f);
    horizon = lerpColor(new THREE.Color(0xff7733), new THREE.Color(0x332222), f);
    sun = lerpColor(new THREE.Color(0xff8844), new THREE.Color(0x553322), f);
    sunIntensity = 1.3 - f * 1.0;
    ambient = lerpColor(new THREE.Color(0x3a2520), new THREE.Color(0x151520), f);
    ambientIntensity = 0.4 - f * 0.2;
    fog = lerpColor(new THREE.Color(0x664433), new THREE.Color(0x151518), f);
    hemiSky = lerpColor(new THREE.Color(0x553344), new THREE.Color(0x1a1a2a), f);
    hemiGround = lerpColor(new THREE.Color(0x1a1510), new THREE.Color(0x0a0a10), f);
  } else {
    // Night (19.5-24)
    zenith = new THREE.Color(0x0a0a1a);
    horizon = new THREE.Color(0x111122);
    sun = new THREE.Color(0x334466);
    sunIntensity = 0.1;
    ambient = new THREE.Color(0x0a0a15);
    ambientIntensity = 0.15;
    fog = new THREE.Color(0x0d0d1a);
    hemiSky = new THREE.Color(0x111125);
    hemiGround = new THREE.Color(0x0a0a10);
  }

  // Weather modifiers
  if (weather >= WEATHER_CLOUDY) {
    const weatherDim = weather === WEATHER_CLOUDY ? 0.15 : weather === WEATHER_OVERCAST ? 0.35 : weather === WEATHER_RAINY ? 0.45 : 0.6;
    const gray = new THREE.Color(0x555560);
    const darkGray = new THREE.Color(0x333338);

    zenith = lerpColor(zenith, darkGray, weatherDim);
    horizon = lerpColor(horizon, gray, weatherDim);
    sunIntensity *= (1 - weatherDim * 0.8);
    ambientIntensity *= (1 + weatherDim * 0.3);
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
uniform float uSunSize;
uniform float uCloudDensity;
uniform float uTime;
uniform float uStarVisibility;

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
  vec2 uv = vec2(atan(dir.x, dir.z), asin(clamp(dir.y, -1.0, 1.0)));
  uv *= vec2(80.0, 80.0);
  float h = hash(floor(uv));
  float star = step(0.995, h);
  // Twinkle
  star *= 0.5 + 0.5 * sin(uTime * 2.0 + h * 100.0);
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

  // Moon (opposite side of sun, subtle)
  vec3 moonDir = -uSunDirection;
  moonDir.y = abs(moonDir.y); // Keep moon above horizon
  float moonDot = max(dot(dir, normalize(moonDir)), 0.0);
  float moonDisc = smoothstep(0.999, 0.9995, moonDot);
  float moonGlow = pow(moonDot, 32.0) * 0.08;
  vec3 moonColor = vec3(0.7, 0.75, 0.85);
  skyColor += moonColor * (moonDisc * 1.5 + moonGlow) * (1.0 - sunDisc);

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

  constructor(
    scene: THREE.Scene,
    sunLight: THREE.DirectionalLight,
    hemiLight: THREE.HemisphereLight,
    ambientLight: THREE.AmbientLight,
  ) {
    this.scene = scene;
    this.sunLight = sunLight;
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
        uSunSize: { value: 1.0 },
        uCloudDensity: { value: 0.3 },
        uTime: { value: 0 },
        uStarVisibility: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyMesh.renderOrder = -1;
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
  update(delta: number): void {
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
    this.skyMaterial.uniforms.uCloudDensity.value = this.currentEnv.cloudDensity;
    this.skyMaterial.uniforms.uTime.value = this.elapsedTime;

    // Sun position based on time of day
    const sunAngle = ((this.currentEnv.timeOfDay - 6) / 24) * Math.PI * 2;
    const sunDir = new THREE.Vector3(
      Math.cos(sunAngle) * 0.5,
      Math.sin(sunAngle),
      Math.sin(sunAngle) * 0.3 + 0.2,
    ).normalize();
    this.skyMaterial.uniforms.uSunDirection.value.copy(sunDir);

    // Star visibility: visible when sun is below horizon
    const starVis = Math.max(0, Math.min(1, -sunDir.y * 3 + 0.2));
    this.skyMaterial.uniforms.uStarVisibility.value = starVis;

    // Update directional light (sun)
    this.sunLight.color.copy(colors.sun);
    this.sunLight.intensity = colors.sunIntensity;
    this.sunLight.position.set(sunDir.x * 80, Math.max(sunDir.y * 80, 5), sunDir.z * 80);
    this.sunLight.target.position.set(64, 0, 64);

    // At night, minimal shadow
    if (sunDir.y < 0.05) {
      this.sunLight.intensity = Math.max(colors.sunIntensity, 0.05);
      this.sunLight.position.y = Math.max(this.sunLight.position.y, 10);
    }

    // Hemisphere light
    this.hemiLight.color.copy(colors.hemiSky);
    this.hemiLight.groundColor.copy(colors.hemiGround);
    this.hemiLight.intensity = 0.6 + colors.ambientIntensity * 0.4;

    // Ambient light
    this.ambientLight.color.copy(colors.ambient);
    this.ambientLight.intensity = colors.ambientIntensity;

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
