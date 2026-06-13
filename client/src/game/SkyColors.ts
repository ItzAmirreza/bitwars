import * as THREE from 'three';

// ── Weather types (must match server) ──
export const WEATHER_CLEAR = 0;
export const WEATHER_CLOUDY = 1;
export const WEATHER_OVERCAST = 2;
export const WEATHER_RAINY = 3;
export const WEATHER_STORMY = 4;

// Weather names are sourced from shared/game-constants.json (single source of truth).
export { WEATHER_NAMES } from '../shared-config';

// ── Environment state from server ──
export interface EnvironmentState {
  timeOfDay: number;    // 0-24
  weather: number;      // 0-4
  windSpeed: number;    // 0-1
  cloudDensity: number; // 0-1
  fogDensity: number;   // 0.5-2.0
}

// ── Sky gradient colors for different times of day ──
export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  haze: THREE.Color;
  cloudTint: THREE.Color;
  starTint: THREE.Color;
}

interface SkyKeyframe {
  hour: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  ambient: THREE.Color;
  ambientIntensity: number;
  fog: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  haze: THREE.Color;
  cloudTint: THREE.Color;
  starTint: THREE.Color;
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  {
    hour: 0,
    zenith: new THREE.Color(0x0b1434),
    horizon: new THREE.Color(0x1e2a4c),
    sun: new THREE.Color(0x9cb6ff),
    sunIntensity: 0.08,
    ambient: new THREE.Color(0x566a9c),
    ambientIntensity: 0.7,
    fog: new THREE.Color(0x1a2442),
    hemiSky: new THREE.Color(0x324772),
    hemiGround: new THREE.Color(0x182033),
    haze: new THREE.Color(0x334065),
    cloudTint: new THREE.Color(0x6f7f9f),
    starTint: new THREE.Color(0xbfd6ff),
  },
  {
    hour: 5.2,
    zenith: new THREE.Color(0x151838),
    horizon: new THREE.Color(0x4a2b35),
    sun: new THREE.Color(0xd1704a),
    sunIntensity: 0.22,
    ambient: new THREE.Color(0x4d466a),
    ambientIntensity: 0.62,
    fog: new THREE.Color(0x3a2c3f),
    hemiSky: new THREE.Color(0x5a4e73),
    hemiGround: new THREE.Color(0x221c1b),
    haze: new THREE.Color(0x8c5962),
    cloudTint: new THREE.Color(0xbd8b80),
    starTint: new THREE.Color(0xc7d2ef),
  },
  {
    hour: 6.8,
    zenith: new THREE.Color(0x29447f),
    horizon: new THREE.Color(0xf09a63),
    sun: new THREE.Color(0xffb57d),
    sunIntensity: 1.05,
    ambient: new THREE.Color(0x5e6378),
    ambientIntensity: 0.46,
    fog: new THREE.Color(0x9c7a68),
    hemiSky: new THREE.Color(0x8b7b95),
    hemiGround: new THREE.Color(0x35291f),
    haze: new THREE.Color(0xffb488),
    cloudTint: new THREE.Color(0xf5b28f),
    starTint: new THREE.Color(0xd5def2),
  },
  {
    hour: 9.5,
    zenith: new THREE.Color(0x4d89c9),
    horizon: new THREE.Color(0xaed1e9),
    sun: new THREE.Color(0xffeccf),
    sunIntensity: 2.05,
    ambient: new THREE.Color(0x677384),
    ambientIntensity: 0.58,
    fog: new THREE.Color(0x8fa7b8),
    hemiSky: new THREE.Color(0x9db5ca),
    hemiGround: new THREE.Color(0x2e271f),
    haze: new THREE.Color(0xdbedf9),
    cloudTint: new THREE.Color(0xffffff),
    starTint: new THREE.Color(0xe4ecff),
  },
  {
    hour: 13,
    zenith: new THREE.Color(0x4f94d4),
    horizon: new THREE.Color(0xb9d9ee),
    sun: new THREE.Color(0xfff2d9),
    sunIntensity: 2.45,
    ambient: new THREE.Color(0x667383),
    ambientIntensity: 0.64,
    fog: new THREE.Color(0x91abbe),
    hemiSky: new THREE.Color(0xa7bfd2),
    hemiGround: new THREE.Color(0x2f271f),
    haze: new THREE.Color(0xe8f4ff),
    cloudTint: new THREE.Color(0xf9fcff),
    starTint: new THREE.Color(0xebf3ff),
  },
  {
    hour: 16.8,
    zenith: new THREE.Color(0x4a73bf),
    horizon: new THREE.Color(0xf2a56c),
    sun: new THREE.Color(0xffbf7c),
    sunIntensity: 1.95,
    ambient: new THREE.Color(0x65596a),
    ambientIntensity: 0.52,
    fog: new THREE.Color(0xa07864),
    hemiSky: new THREE.Color(0x9e7e8e),
    hemiGround: new THREE.Color(0x2a211b),
    haze: new THREE.Color(0xffb67a),
    cloudTint: new THREE.Color(0xf1b48d),
    starTint: new THREE.Color(0xdde8ff),
  },
  {
    hour: 18.6,
    zenith: new THREE.Color(0x1c2f5f),
    horizon: new THREE.Color(0xe1704f),
    sun: new THREE.Color(0xff9663),
    sunIntensity: 0.75,
    ambient: new THREE.Color(0x5f4c63),
    ambientIntensity: 0.5,
    fog: new THREE.Color(0x5d3f52),
    hemiSky: new THREE.Color(0x6d5673),
    hemiGround: new THREE.Color(0x211a18),
    haze: new THREE.Color(0xd08062),
    cloudTint: new THREE.Color(0xcf8f7d),
    starTint: new THREE.Color(0xcfddff),
  },
  {
    hour: 20.2,
    zenith: new THREE.Color(0x0f1b3a),
    horizon: new THREE.Color(0x243a5f),
    sun: new THREE.Color(0x9cb4ff),
    sunIntensity: 0.12,
    ambient: new THREE.Color(0x5970a2),
    ambientIntensity: 0.72,
    fog: new THREE.Color(0x1c2747),
    hemiSky: new THREE.Color(0x36507c),
    hemiGround: new THREE.Color(0x192033),
    haze: new THREE.Color(0x304772),
    cloudTint: new THREE.Color(0x7e8ca8),
    starTint: new THREE.Color(0xbfd6ff),
  },
  {
    hour: 24,
    zenith: new THREE.Color(0x0b1434),
    horizon: new THREE.Color(0x1e2a4c),
    sun: new THREE.Color(0x9cb6ff),
    sunIntensity: 0.08,
    ambient: new THREE.Color(0x566a9c),
    ambientIntensity: 0.7,
    fog: new THREE.Color(0x1a2442),
    hemiSky: new THREE.Color(0x324772),
    hemiGround: new THREE.Color(0x182033),
    haze: new THREE.Color(0x334065),
    cloudTint: new THREE.Color(0x6f7f9f),
    starTint: new THREE.Color(0xbfd6ff),
  },
];

const WEATHER_WEIGHTS = [0, 0.18, 0.36, 0.5, 0.66] as const;
const WEATHER_MID_GRAY = new THREE.Color(0x575d69);
const WEATHER_DARK_GRAY = new THREE.Color(0x2e3440);
const WEATHER_FOG_GRAY = new THREE.Color(0x4b5663);

const OUT_COLORS: SkyColors = {
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  sun: new THREE.Color(),
  sunIntensity: 1,
  ambient: new THREE.Color(),
  ambientIntensity: 1,
  fog: new THREE.Color(),
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  haze: new THREE.Color(),
  cloudTint: new THREE.Color(),
  starTint: new THREE.Color(),
};

function sampleTimePalette(hour: number, out: SkyColors): void {
  const wrappedHour = ((hour % 24) + 24) % 24;

  let a = SKY_KEYFRAMES[0];
  let b = SKY_KEYFRAMES[1];
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const left = SKY_KEYFRAMES[i];
    const right = SKY_KEYFRAMES[i + 1];
    if (wrappedHour >= left.hour && wrappedHour < right.hour) {
      a = left;
      b = right;
      break;
    }
  }

  const span = Math.max(0.0001, b.hour - a.hour);
  const t = (wrappedHour - a.hour) / span;

  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.ambient.copy(a.ambient).lerp(b.ambient, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.haze.copy(a.haze).lerp(b.haze, t);
  out.cloudTint.copy(a.cloudTint).lerp(b.cloudTint, t);
  out.starTint.copy(a.starTint).lerp(b.starTint, t);

  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  out.ambientIntensity = a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * t;
}

export function getSkyColors(hour: number, weather: number): SkyColors {
  sampleTimePalette(hour, OUT_COLORS);

  const weatherIndex = Math.max(0, Math.min(WEATHER_WEIGHTS.length - 1, Math.floor(weather)));
  const weatherWeight = WEATHER_WEIGHTS[weatherIndex];

  if (weatherWeight > 0) {
    OUT_COLORS.zenith.lerp(WEATHER_DARK_GRAY, weatherWeight * 0.7);
    OUT_COLORS.horizon.lerp(WEATHER_MID_GRAY, weatherWeight * 0.82);
    OUT_COLORS.sun.lerp(WEATHER_MID_GRAY, weatherWeight * 0.32);
    OUT_COLORS.ambient.lerp(WEATHER_MID_GRAY, weatherWeight * 0.26);
    OUT_COLORS.fog.lerp(WEATHER_FOG_GRAY, weatherWeight * 0.88);
    OUT_COLORS.hemiSky.lerp(WEATHER_MID_GRAY, weatherWeight * 0.72);
    OUT_COLORS.haze.lerp(WEATHER_FOG_GRAY, weatherWeight * 0.74);
    OUT_COLORS.cloudTint.lerp(WEATHER_MID_GRAY, weatherWeight * 0.64);
    OUT_COLORS.starTint.multiplyScalar(1 - weatherWeight * 0.48);

    OUT_COLORS.sunIntensity *= 1 - weatherWeight * 0.82;
    OUT_COLORS.ambientIntensity *= 1 + weatherWeight * 0.2;
  }

  OUT_COLORS.sunIntensity = Math.max(0.05, OUT_COLORS.sunIntensity);
  OUT_COLORS.ambientIntensity = Math.max(0.35, OUT_COLORS.ambientIntensity);

  return OUT_COLORS;
}

// ── Sky dome shader ──
export const skyVertexShader = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragmentShader = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHazeColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform vec3 uMoonDirection;
uniform vec3 uMoonColor;
uniform vec3 uCloudTint;
uniform vec3 uStarTint;
uniform float uSunSize;
uniform float uCloudDensity;
uniform float uTime;
uniform float uStarVisibility;
uniform float uMoonVisibility;
uniform float uStormFlash;

varying vec3 vWorldPosition;

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
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

float starField(vec3 dir) {
  vec2 uv = vec2(
    atan(dir.x, dir.z) / 6.28318530718 + 0.5,
    asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5
  );
  uv *= vec2(220.0, 110.0);

  vec2 cell = floor(uv);
  vec2 local = fract(uv) - 0.5;
  float h = hash(cell);
  float starMask = step(0.9968, h);
  vec2 offset = vec2(hash(cell + 11.7), hash(cell + 27.1)) - 0.5;
  vec2 p = local - offset * 0.35;
  float dist = length(vec2(p.x, p.y * 1.4));
  float star = smoothstep(0.12, 0.0, dist) * starMask;
  float twinkle = 0.55 + 0.45 * sin(uTime * 1.6 + h * 120.0);
  star *= twinkle;
  return star;
}

void main() {
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float y = dir.y;

  float horizonFade = smoothstep(-0.18, 0.48, y);
  vec3 skyColor = mix(uHorizon, uZenith, horizonFade);

  float haze = exp(-max(y + 0.22, 0.0) * 6.0);
  skyColor = mix(skyColor, uHazeColor, clamp(haze * 0.58, 0.0, 1.0));

  float sunDot = max(dot(dir, uSunDirection), 0.0);
  float sunDisc = smoothstep(1.0 - uSunSize * 0.00044, 1.0 - uSunSize * 0.00014, sunDot);
  float sunGlow = pow(sunDot, 10.0) * 0.34;
  float sunHalo = pow(sunDot, 2.2) * (0.08 + (1.0 - horizonFade) * 0.35);
  skyColor += uSunColor * (sunDisc * 2.8 + sunGlow + sunHalo);

  float cloudMask = 0.0;

  if (uCloudDensity > 0.03 && y > 0.02) {
    float invY = 1.0 / max(y + 0.32, 0.08);
    vec2 baseUV = dir.xz * invY;
    vec2 driftA = vec2(uTime * 0.0045, -uTime * 0.0014);
    vec2 driftB = vec2(-uTime * 0.0075, uTime * 0.0032);

    float cloudA = fbm(baseUV * 2.25 + driftA);
    float cloudB = fbm(baseUV * 4.9 + driftB);

    float coverage = smoothstep(
      1.02 - uCloudDensity * 1.02,
      1.2 - uCloudDensity * 0.68,
      cloudA + cloudB * 0.42
    );
    float detail = smoothstep(0.38, 0.9, cloudB);
    cloudMask = coverage * (0.62 + detail * 0.42);
    // Fade clouds out near horizon so they don't extend below
    cloudMask *= smoothstep(0.02, 0.12, y);

    float cloudLight = pow(max(dot(normalize(vec3(dir.x, max(dir.y, 0.04), dir.z)), uSunDirection), 0.0), 8.0);
    vec3 cloudColor = mix(uCloudTint * 0.74, uCloudTint * 1.08 + uSunColor * 0.24, cloudLight);
    cloudColor *= mix(1.0, 0.72, smoothstep(0.45, 1.0, uCloudDensity));

    skyColor = mix(skyColor, cloudColor, cloudMask * 0.8);
  }

  if (uMoonVisibility > 0.01) {
    float moonDot = max(dot(dir, normalize(uMoonDirection)), 0.0);
    float moonDisc = smoothstep(0.9986, 0.99925, moonDot);
    float moonGlow = pow(moonDot, 20.0) * 0.13;
    skyColor += uMoonColor * (moonDisc * 1.5 + moonGlow) * (1.0 - sunDisc) * uMoonVisibility;
  }

  if (uStarVisibility > 0.01) {
    float stars = starField(dir) * uStarVisibility;
    stars *= 1.0 - cloudMask * 0.9;
    skyColor += uStarTint * stars;
  }

  if (uStormFlash > 0.001) {
    skyColor += vec3(0.32, 0.39, 0.47) * uStormFlash * (0.14 + cloudMask * 0.45);
  }

  float fogBlend = smoothstep(0.1, -0.05, y);
  skyColor = mix(skyColor, uHorizon, fogBlend * 0.56);

  float luma = dot(skyColor, vec3(0.2126, 0.7152, 0.0722));
  skyColor = mix(vec3(luma), skyColor, 1.06);

  gl_FragColor = vec4(skyColor, 1.0);
}
`;

// ── Rain system constants ──
export const RAIN_COUNT = 4200;
export const RAIN_RADIUS = 34;
export const RAIN_HEIGHT = 72;

export const rainVertexShader = `
attribute float size;
attribute float speed;
attribute float seed;
uniform float uTime;
uniform float uWindX;
uniform float uWindZ;
uniform float uRainDensity;
varying float vAlpha;
varying vec2 vStreakDir;
varying float vHighlight;

void main() {
  const float fieldRadius = ${RAIN_RADIUS.toFixed(1)};
  const float fieldHeight = ${RAIN_HEIGHT.toFixed(1)};

  float phase = fract((position.y + fieldHeight * 0.5) / fieldHeight + (uTime * speed) / fieldHeight + seed);
  float fall = mix(fieldHeight * 0.5, -fieldHeight * 0.5, phase);

  float gustA = sin(uTime * 0.7 + seed * 17.0);
  float gustB = sin(uTime * 1.8 + seed * 43.0);
  vec2 wind = vec2(uWindX, uWindZ) * (0.55 + speed * 0.028);
  wind += vec2(gustA * 0.28 + gustB * 0.08, gustB * 0.22);

  vec3 localPos;
  localPos.x = mod(position.x + wind.x * phase * fieldHeight + fieldRadius, fieldRadius * 2.0) - fieldRadius;
  localPos.y = fall + 10.0;
  localPos.z = mod(position.z + wind.y * phase * fieldHeight + fieldRadius, fieldRadius * 2.0) - fieldRadius;

  vec3 worldPos = localPos + cameraPosition;
  vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);

  float radialFade = 1.0 - smoothstep(fieldRadius * 0.55, fieldRadius, length(localPos.xz));
  float depthFade = smoothstep(5.0, 18.0, length(mvPosition.xyz));
  float lifecycleFade = smoothstep(0.02, 0.16, phase) * (1.0 - smoothstep(0.78, 0.98, phase));
  vAlpha = radialFade * depthFade * lifecycleFade * uRainDensity;

  vec3 velocity = vec3(wind.x * speed * 0.45, -speed, wind.y * speed * 0.45);
  vec3 viewVelocity = (viewMatrix * vec4(velocity, 0.0)).xyz;
  float dirLen = max(length(viewVelocity.xy), 0.0001);
  vStreakDir = viewVelocity.xy / dirLen;
  vHighlight = clamp(speed / 34.0, 0.55, 1.0);

  gl_PointSize = clamp(size * (90.0 / max(-mvPosition.z, 1.0)), 2.0, 15.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const rainFragmentShader = `
varying float vAlpha;
varying vec2 vStreakDir;
varying float vHighlight;
uniform vec3 uRainColor;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  vec2 dir = vStreakDir;
  float dirLen = length(dir);
  if (dirLen < 0.001) {
    dir = vec2(0.0, -1.0);
  } else {
    dir /= dirLen;
  }

  vec2 normal = vec2(-dir.y, dir.x);
  float along = dot(uv, dir);
  float across = dot(uv, normal);

  float body = 1.0 - smoothstep(0.68, 1.0, abs(along));
  float width = 1.0 - smoothstep(0.04, 0.16, abs(across) + abs(along) * 0.09);
  float core = 1.0 - smoothstep(0.015, 0.075, abs(across));
  float tip = 1.0 - smoothstep(-0.95, -0.2, along);
  float tail = 1.0 - smoothstep(0.35, 1.0, along);

  float alpha = body * width;
  alpha *= 0.45 + core * 0.35 + tail * 0.15;
  alpha *= vAlpha;

  if (alpha <= 0.01) discard;

  vec3 color = mix(uRainColor * 0.82, vec3(0.92, 0.96, 1.0), core * 0.45 + tip * 0.2);
  color *= 0.9 + vHighlight * 0.25;

  gl_FragColor = vec4(color, alpha);
}
`;

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
