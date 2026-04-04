import * as THREE from "three";

import type { DbConnection } from "../module_bindings";
import {
  buildJamPortalUrl,
  buildReturnPortalUrl,
  getPortalContext,
  type PortalContext,
} from "../portal";
import type { VoxelWorld } from "./VoxelWorld";
import { WORLD_X, WORLD_Z } from "./VoxelWorld";

type PortalKey = "exit" | "return";
type PortalFacing = "east" | "west";

type PortalPlacement = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

type PortalParticle = {
  mesh: THREE.Mesh;
  angle: number;
  radius: number;
  speed: number;
  height: number;
  phase: number;
};

type PortalInstance = {
  key: PortalKey;
  group: THREE.Group;
  frameMaterial: THREE.MeshPhongMaterial;
  coreMaterial: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  labelTexture: THREE.CanvasTexture;
  labelMaterial: THREE.SpriteMaterial;
  labelSprite: THREE.Sprite;
  particles: PortalParticle[];
  placement: PortalPlacement;
  enabled: boolean;
};

const PORTAL_CLEARANCE_HEIGHT = 7;
const PORTAL_SURFACE_TOLERANCE = 1;
const PORTAL_PAD_HALF_WIDTH_X = 1;
const PORTAL_PAD_HALF_WIDTH_Z = 2;
const PORTAL_TRIGGER_HALF_WIDTH = 1.5;
const PORTAL_TRIGGER_HALF_DEPTH = 1.2;
const PORTAL_TRIGGER_MIN_Y = 0.6;
const PORTAL_TRIGGER_MAX_Y = 5.8;
const PORTAL_DWELL_MS = 180;

const EXIT_CANDIDATES: Array<[number, number]> = [
  [12, 0],
  [14, 4],
  [14, -4],
  [18, 0],
  [10, 6],
  [10, -6],
];

const RETURN_CANDIDATES: Array<[number, number]> = [
  [-12, 0],
  [-14, 4],
  [-14, -4],
  [-18, 0],
  [-10, 6],
  [-10, -6],
];

export class PortalSystem {
  private readonly scene: THREE.Scene;
  private readonly world: VoxelWorld;
  private readonly conn: DbConnection | null;
  private readonly portalContext: PortalContext;

  private exitPortal: PortalInstance | null = null;
  private returnPortal: PortalInstance | null = null;
  private portalsCreated = false;
  private activePortalKey: PortalKey | null = null;
  private activePortalSince = 0;
  private redirecting = false;
  private elapsed = 0;

  private arrivalSettled: boolean;
  private arrivalInFlight = false;
  private arrivalAttempts = 0;
  private nextArrivalAttemptAt = 0;

  constructor(scene: THREE.Scene, world: VoxelWorld, conn: DbConnection | null) {
    this.scene = scene;
    this.world = world;
    this.conn = conn;
    this.portalContext = getPortalContext();
    this.arrivalSettled = !this.portalContext.isPortalArrival;
  }

  update(
    delta: number,
    worldReady: boolean,
    playerPosition: THREE.Vector3 | null,
    username: string | null,
    hp: number,
    speed: number | null,
  ): void {
    this.elapsed += delta;

    if (worldReady && !this.portalsCreated) {
      this.createPortals();
    }

    this.animatePortals();
    this.maybeRequestArrivalSpawn(worldReady);
    this.checkPortalTriggers(playerPosition, username, hp, speed);
  }

  destroy(): void {
    this.disposePortal(this.exitPortal);
    this.disposePortal(this.returnPortal);
    this.exitPortal = null;
    this.returnPortal = null;
  }

  private maybeRequestArrivalSpawn(worldReady: boolean): void {
    if (
      !worldReady ||
      !this.portalContext.isPortalArrival ||
      this.arrivalSettled ||
      this.arrivalInFlight ||
      !this.conn
    ) {
      return;
    }

    const now = performance.now();
    if (now < this.nextArrivalAttemptAt || this.arrivalAttempts >= 5) {
      return;
    }

    this.arrivalInFlight = true;
    this.arrivalAttempts += 1;
    void (this.conn.reducers as any).portalArrive({})
      .then(() => {
        this.arrivalSettled = true;
      })
      .catch((error: unknown) => {
        console.error("[BitWars] Portal arrival reducer failed:", error);
        this.nextArrivalAttemptAt = performance.now() + 750;
      })
      .finally(() => {
        this.arrivalInFlight = false;
      });
  }

  private checkPortalTriggers(
    playerPosition: THREE.Vector3 | null,
    username: string | null,
    hp: number,
    speed: number | null,
  ): void {
    if (!playerPosition || this.redirecting) return;

    const portals = [this.exitPortal, this.returnPortal].filter(
      (portal): portal is PortalInstance => Boolean(portal?.enabled),
    );
    let insidePortal: PortalKey | null = null;

    for (const portal of portals) {
      const localPos = portal.group.worldToLocal(playerPosition.clone());
      if (
        Math.abs(localPos.x) <= PORTAL_TRIGGER_HALF_DEPTH &&
        Math.abs(localPos.z) <= PORTAL_TRIGGER_HALF_WIDTH &&
        localPos.y >= PORTAL_TRIGGER_MIN_Y &&
        localPos.y <= PORTAL_TRIGGER_MAX_Y
      ) {
        insidePortal = portal.key;
        break;
      }
    }

    if (!insidePortal) {
      this.activePortalKey = null;
      this.activePortalSince = 0;
      return;
    }

    const now = performance.now();
    if (this.activePortalKey !== insidePortal) {
      this.activePortalKey = insidePortal;
      this.activePortalSince = now;
      return;
    }

    if (now - this.activePortalSince < PORTAL_DWELL_MS) {
      return;
    }

    const speedValue =
      typeof speed === "number" && Number.isFinite(speed) ? speed : undefined;
    const nextUrl = insidePortal === "exit"
      ? buildJamPortalUrl({
        username,
        hp,
        speed: speedValue,
      })
      : buildReturnPortalUrl(this.portalContext, {
        username: username ?? this.portalContext.incomingUsername,
        hp,
        speed: speedValue,
      });

    if (!nextUrl) return;
    this.redirecting = true;
    window.location.assign(nextUrl);
  }

  private animatePortals(): void {
    for (const portal of [this.exitPortal, this.returnPortal]) {
      if (!portal?.enabled) continue;

      const pulse = 0.7 + Math.sin(this.elapsed * 1.8 + portal.placement.x * 0.04) * 0.2;
      portal.coreMaterial.opacity = 0.3 + pulse * 0.2;
      portal.light.intensity = 1.1 + pulse * 0.9;

      for (const particle of portal.particles) {
        const t = this.elapsed * particle.speed + particle.phase;
        const angle = t + particle.angle;
        particle.mesh.position.set(
          Math.cos(angle * 1.2) * 0.18,
          particle.height + Math.sin(t * 1.7) * 0.2,
          Math.sin(angle) * particle.radius,
        );
        (particle.mesh.material as THREE.MeshBasicMaterial).opacity =
          0.45 + Math.sin(t * 2.1) * 0.12;
      }
    }
  }

  private createPortals(): void {
    if (this.portalsCreated) return;
    this.portalsCreated = true;

    const exitPlacement = this.findPlacement(EXIT_CANDIDATES, "west");
    if (exitPlacement) {
      this.exitPortal = this.createPortal(
        "exit",
        exitPlacement,
        "#00e5ff",
        "#7c4dff",
        "VIBE JAM PORTAL",
      );
    }

    if (this.portalContext.isPortalArrival) {
      const returnPlacement = this.findPlacement(RETURN_CANDIDATES, "east");
      if (returnPlacement) {
        const label = this.portalContext.refLabel
          ? `BACK TO ${this.portalContext.refLabel}`
          : "PORTAL ARRIVAL";
        this.returnPortal = this.createPortal(
          "return",
          returnPlacement,
          "#76ff03",
          "#ff6b35",
          label,
        );
        this.returnPortal.enabled = true;
      }
    }
  }

  private findPlacement(
    candidates: Array<[number, number]>,
    facing: PortalFacing,
  ): PortalPlacement | null {
    const centerX = Math.floor(WORLD_X * 0.5);
    const centerZ = Math.floor(WORLD_Z * 0.5);

    for (const [offsetX, offsetZ] of candidates) {
      const portalX = centerX + offsetX;
      const portalZ = centerZ + offsetZ;
      const baseY = this.findPortalBaseY(portalX, portalZ);
      if (baseY === null) continue;
      return {
        x: portalX + 0.5,
        y: baseY + 0.5,
        z: portalZ + 0.5,
        yaw: facing === "east" ? Math.PI * 0.5 : -Math.PI * 0.5,
      };
    }

    return null;
  }

  private findPortalBaseY(portalX: number, portalZ: number): number | null {
    let minSurface = Number.POSITIVE_INFINITY;
    let maxSurface = Number.NEGATIVE_INFINITY;

    for (let dx = -PORTAL_PAD_HALF_WIDTH_X; dx <= PORTAL_PAD_HALF_WIDTH_X; dx++) {
      for (let dz = -PORTAL_PAD_HALF_WIDTH_Z; dz <= PORTAL_PAD_HALF_WIDTH_Z; dz++) {
        const top = this.world.getHighestBlock(portalX + dx, portalZ + dz);
        if (top < 0) return null;
        minSurface = Math.min(minSurface, top);
        maxSurface = Math.max(maxSurface, top);
      }
    }

    if (maxSurface - minSurface > PORTAL_SURFACE_TOLERANCE) {
      return null;
    }

    const baseY = maxSurface + 1;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let y = baseY; y <= baseY + PORTAL_CLEARANCE_HEIGHT; y++) {
          if (this.world.getBlock(portalX + dx, y, portalZ + dz) !== 0) {
            return null;
          }
        }
      }
    }

    return baseY;
  }

  private createPortal(
    key: PortalKey,
    placement: PortalPlacement,
    primaryColor: string,
    accentColor: string,
    label: string,
  ): PortalInstance {
    const group = new THREE.Group();
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.yaw;

    const frameMaterial = new THREE.MeshPhongMaterial({
      color: new THREE.Color(primaryColor),
      emissive: new THREE.Color(accentColor),
      emissiveIntensity: 0.45,
      transparent: false,
    });

    const coreMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(primaryColor),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 5.2, 3.2),
      coreMaterial,
    );
    core.position.set(0, 3, 0);
    group.add(core);

    for (let z = -2; z <= 2; z++) {
      this.addFrameBlock(group, frameMaterial, 0, 0, z);
      this.addFrameBlock(group, frameMaterial, 0, 6, z);
    }
    for (let y = 1; y <= 5; y++) {
      this.addFrameBlock(group, frameMaterial, 0, y, -2);
      this.addFrameBlock(group, frameMaterial, 0, y, 2);
    }

    const light = new THREE.PointLight(primaryColor, 1.8, 24, 2);
    light.position.set(0, 3, 0);
    group.add(light);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 1024;
    labelCanvas.height = 192;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.minFilter = THREE.LinearFilter;
    labelTexture.magFilter = THREE.LinearFilter;
    this.drawLabel(labelCanvas, labelTexture, label, primaryColor, accentColor);

    const labelMaterial = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: false,
    });
    const labelSprite = new THREE.Sprite(labelMaterial);
    labelSprite.position.set(0, 8.2, 0);
    labelSprite.scale.set(7.2, 1.35, 1);
    group.add(labelSprite);

    const particles: PortalParticle[] = [];
    for (let i = 0; i < 16; i++) {
      const particleMaterial = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? primaryColor : accentColor,
        transparent: true,
        opacity: 0.5,
      });
      const particle = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.22, 0.22),
        particleMaterial,
      );
      particle.position.set(0, 1 + (i % 6) * 0.7, 0);
      group.add(particle);
      particles.push({
        mesh: particle,
        angle: (Math.PI * 2 * i) / 16,
        radius: 0.3 + (i % 3) * 0.18,
        speed: 1.2 + (i % 5) * 0.18,
        height: 1.1 + (i % 6) * 0.72,
        phase: (Math.PI * 2 * i) / 16,
      });
    }

    this.scene.add(group);
    group.updateMatrixWorld(true);
    return {
      key,
      group,
      frameMaterial,
      coreMaterial,
      light,
      labelTexture,
      labelMaterial,
      labelSprite,
      particles,
      placement,
      enabled: true,
    };
  }

  private addFrameBlock(
    group: THREE.Group,
    material: THREE.MeshPhongMaterial,
    x: number,
    y: number,
    z: number,
  ): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private drawLabel(
    canvas: HTMLCanvasElement,
    texture: THREE.CanvasTexture,
    label: string,
    primaryColor: string,
    accentColor: string,
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "rgba(6, 12, 22, 0.92)";
    ctx.fillRect(32, 20, w - 64, h - 40);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 10;
    ctx.strokeRect(32, 20, w - 64, h - 40);

    const displayLabel = label.length > 28 ? `${label.slice(0, 28)}...` : label;
    ctx.font = 'bold 54px "Press Start 2P", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000000";
    ctx.fillText(displayLabel, w / 2 + 6, h / 2 + 6);
    ctx.fillStyle = primaryColor;
    ctx.fillText(displayLabel, w / 2, h / 2);

    texture.needsUpdate = true;
  }

  private disposePortal(portal: PortalInstance | null): void {
    if (!portal) return;
    this.scene.remove(portal.group);
    portal.frameMaterial.dispose();
    portal.coreMaterial.dispose();
    portal.light.dispose();
    portal.labelTexture.dispose();
    portal.labelMaterial.dispose();
    for (const particle of portal.particles) {
      particle.mesh.geometry.dispose();
      (particle.mesh.material as THREE.Material).dispose();
    }
    for (const child of portal.group.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }
  }
}
