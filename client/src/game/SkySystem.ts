import * as THREE from 'three';
import {
  type EnvironmentState,
  WEATHER_RAINY,
  WEATHER_STORMY,
  WEATHER_NAMES,
  getSkyColors,
  clamp01,
  skyVertexShader,
  skyFragmentShader,
  rainVertexShader,
  rainFragmentShader,
  RAIN_COUNT,
  RAIN_RADIUS,
  RAIN_HEIGHT,
} from './SkyColors';

// Re-export for consumers
export type { EnvironmentState } from './SkyColors';
export { WEATHER_CLEAR, WEATHER_CLOUDY, WEATHER_OVERCAST, WEATHER_RAINY, WEATHER_STORMY, WEATHER_NAMES } from './SkyColors';

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

  // Baked terrain radiance tints (consumed by VoxelWorld's light uniforms)
  private terrainLightEnv = {
    sunTint: new THREE.Color(1, 0.96, 0.88),
    torchTint: new THREE.Color(1.25, 0.78, 0.42),
    skyAmbient: new THREE.Color(0.3, 0.32, 0.38),
    groundAmbient: new THREE.Color(0.2, 0.18, 0.15),
    sunDir: new THREE.Vector3(0.4, 0.8, 0.3),
    shadowStrength: 0,
  };
  private _tintScratch = new THREE.Color();
  private moonColor = new THREE.Color(0.62, 0.72, 0.95);
  private fogColor = new THREE.Color(0x8899aa);

  // Storm lightning (visual only)
  private stormFlash = 0;
  private stormNextStrike = 4.5;

  // Rain color blending
  private rainBaseColor = new THREE.Color(0.72, 0.78, 0.86);
  private rainFlashColor = new THREE.Color(0.9, 0.95, 1.0);
  private rainMixedColor = new THREE.Color();

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
        uHazeColor: { value: new THREE.Color(0xa6c4de) },
        uSunColor: { value: new THREE.Color(0xfff0d0) },
        uSunDirection: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
        uMoonDirection: { value: new THREE.Vector3(-0.25, 0.6, -0.2).normalize() },
        uMoonColor: { value: new THREE.Color(0.62, 0.72, 0.95) },
        uCloudTint: { value: new THREE.Color(0xf2f6ff) },
        uStarTint: { value: new THREE.Color(0xc6daff) },
        uSunSize: { value: 1.0 },
        uCloudDensity: { value: 0.3 },
        uTime: { value: 0 },
        uStarVisibility: { value: 0 },
        uMoonVisibility: { value: 0 },
        uStormFlash: { value: 0 },
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
    const seeds = new Float32Array(RAIN_COUNT);

    for (let i = 0; i < RAIN_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * RAIN_RADIUS * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * RAIN_HEIGHT;
      positions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_RADIUS * 2;
      sizes[i] = 1.9 + Math.random() * 2.2;
      speeds[i] = 18 + Math.random() * 14;
      seeds[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

    this.rainMaterial = new THREE.ShaderMaterial({
      vertexShader: rainVertexShader,
      fragmentShader: rainFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uWindX: { value: 0.14 },
          uWindZ: { value: -0.06 },
          uRainDensity: { value: 0.8 },
          uRainColor: { value: this.rainBaseColor.clone() },
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
    this.skyMaterial.uniforms.uHazeColor.value.copy(colors.haze);
    this.skyMaterial.uniforms.uSunColor.value.copy(colors.sun);
    this.skyMaterial.uniforms.uMoonColor.value.copy(this.moonColor);
    this.skyMaterial.uniforms.uCloudTint.value.copy(colors.cloudTint);
    this.skyMaterial.uniforms.uStarTint.value.copy(colors.starTint);
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

    this.updateStormFlash(delta);
    const cloudStarPenalty = clamp01(this.currentEnv.cloudDensity * 0.85);
    this.skyMaterial.uniforms.uStarVisibility.value = nightFactor * (1 - cloudStarPenalty);
    this.skyMaterial.uniforms.uMoonVisibility.value = moonVisibility;
    this.skyMaterial.uniforms.uStormFlash.value = this.stormFlash;

    // Update directional light (sun) — must follow camera so shadows stay around player,
    // and direction must match the visual sun in the sky shader
    this.sunLight.color.copy(colors.sun);
    this.sunLight.intensity = colors.sunIntensity * sunAboveHorizon + this.stormFlash * 0.08;

    if (cameraPosition) {
      // Light shines FROM sun direction toward camera — shadows match visual sun
      this.sunLight.position.set(
        cameraPosition.x + sunDir.x * 80,
        cameraPosition.y + Math.max(sunDir.y * 80, 5),
        cameraPosition.z + sunDir.z * 80,
      );
      this.sunLight.target.position.copy(cameraPosition);
      this.sunLight.target.updateMatrixWorld();
    } else {
      this.sunLight.position.set(sunDir.x * 80, Math.max(sunDir.y * 80, 5), sunDir.z * 80);
      this.sunLight.target.position.set(0, 0, 0);
      this.sunLight.target.updateMatrixWorld();
    }

    // Moon light gives readable contrast for competitive nighttime gameplay
    this.moonLight.color.copy(this.moonColor);
    this.moonLight.intensity = 0.4 + moonVisibility * 1.1 + this.stormFlash * 0.05;
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
    this.hemiLight.intensity = Math.max(0.95, 0.78 + colors.ambientIntensity * 0.56 + this.stormFlash * 0.12);

    // Ambient light
    this.ambientLight.color.copy(colors.ambient);
    this.ambientLight.intensity = Math.max(colors.ambientIntensity, 0.7 + nightFactor * 0.28) + this.stormFlash * 0.1;

    // Renderer exposure target (higher floor at night to prevent black crush)
    const weatherPenalty = clamp01(this.currentEnv.cloudDensity * 0.22);
    this.exposure = 1.12 + nightFactor * 0.66 - weatherPenalty * 0.55 + this.stormFlash * 0.05;

    // Terrain radiance tints for the baked voxel light channels: the sky
    // channel is tinted by sun (and moon at night), lanterns stay warm, and
    // the hemisphere ambient pair keeps interiors readable while giving
    // faces a sky-vs-ground color gradient
    // Kept well under tone-mapper saturation so block albedo stays rich —
    // peak radiance on sunlit faces lands near 1.2x, not blown out
    const sunStrength = Math.min(1.6, colors.sunIntensity) * sunAboveHorizon * 0.55;
    this.terrainLightEnv.sunTint
      .copy(colors.sun)
      .multiplyScalar(sunStrength)
      .add(this._tintScratch.copy(this.moonColor).multiplyScalar(moonVisibility * 0.3));
    this.terrainLightEnv.skyAmbient
      .copy(colors.hemiSky)
      .multiplyScalar(0.16 + sunAboveHorizon * 0.11)
      .addScalar(0.04 + this.stormFlash * 0.1);
    this.terrainLightEnv.groundAmbient
      .copy(colors.hemiGround)
      .multiplyScalar(0.115 + sunAboveHorizon * 0.07)
      .addScalar(0.03 + this.stormFlash * 0.06);
    // Directional shading follows the dominant luminary (sun by day, moon by night)
    this.terrainLightEnv.sunDir.copy(sunAboveHorizon >= 0.12 ? sunDir : moonDir);
    // Cast-shadow strength: crisp under a clear sun, softer moonlit shadows
    // at night, fading out as cloud cover diffuses the light
    const cloudDiffuse = clamp01(this.currentEnv.cloudDensity * 0.85);
    this.terrainLightEnv.shadowStrength =
      Math.max(sunAboveHorizon, moonVisibility * 0.6) * (1 - cloudDiffuse * 0.92);

    // Fog
    this.fogColor.copy(colors.fog).lerp(colors.haze, this.stormFlash * 0.08);
    if (this.scene.fog instanceof THREE.Fog) {
      (this.scene.fog as THREE.Fog).color.copy(this.fogColor);
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
      this.rainMaterial.uniforms.uWindX.value = this.currentEnv.windSpeed * 0.35 - 0.08;
      this.rainMaterial.uniforms.uWindZ.value = this.currentEnv.windSpeed * 0.2 - 0.05;
      this.rainMaterial.uniforms.uRainDensity.value = this.currentEnv.weather >= WEATHER_STORMY ? 1.0 : 0.78;
      this.rainMixedColor.copy(this.rainBaseColor).lerp(this.rainFlashColor, this.stormFlash * 0.45);
      this.rainMaterial.uniforms.uRainColor.value.copy(this.rainMixedColor);
      this.rainMesh.visible = true;
    }
  }

  /** Get current fog color for renderer clear color */
  getFogColor(): THREE.Color {
    return this.fogColor;
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

  /** Stable references; values are refreshed every update(). */
  getTerrainLightEnv(): {
    sunTint: THREE.Color;
    torchTint: THREE.Color;
    skyAmbient: THREE.Color;
    groundAmbient: THREE.Color;
    sunDir: THREE.Vector3;
    shadowStrength: number;
  } {
    return this.terrainLightEnv;
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

  private updateStormFlash(delta: number): void {
    if (this.currentEnv.weather < WEATHER_STORMY) {
      this.stormFlash = Math.max(0, this.stormFlash - delta * 3.5);
      this.stormNextStrike = 3.5;
      return;
    }

    this.stormNextStrike -= delta * (0.35 + this.currentEnv.windSpeed * 0.35);
    if (this.stormNextStrike <= 0) {
      this.stormFlash = 0.28 + Math.random() * 0.22;
      this.stormNextStrike = 3.5 + Math.random() * 7.5;
    }

    this.stormFlash = Math.max(0, this.stormFlash - delta * 6.5);
  }

  dispose(): void {
    this.scene.remove(this.skyMesh);
    this.skyMesh.geometry.dispose();
    this.skyMaterial.dispose();
    this.removeRain();
  }
}
