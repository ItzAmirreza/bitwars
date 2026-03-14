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
}

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color().lerpColors(a, b, t);
}

export function getSkyColors(hour: number, weather: number): SkyColors {
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
    // Afternoon -> sunset (16-18)
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
