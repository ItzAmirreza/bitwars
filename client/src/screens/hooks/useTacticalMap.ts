import { useEffect, useState } from 'react';
import type { DbConnection } from '../../module_bindings';
import { getCharacterPreset, colorHex } from '../../characterPresets';
import { WORLD, VEHICLE_TYPES } from '../../shared-config';

export interface TacticalMapPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  color: string;
  isSelf: boolean;
  isMounted: boolean;
  alive: boolean;
}

export interface TacticalMapVehicle {
  id: number;
  type: number;
  label: string;
  shortLabel: string;
  x: number;
  z: number;
  yaw: number;
  occupied: boolean;
  color: string;
}

export interface TacticalMapSnapshot {
  width: number;
  height: number;
  players: TacticalMapPlayer[];
  vehicles: TacticalMapVehicle[];
  selfX: number;
  selfZ: number;
  stats: {
    players: number;
    vehicles: number;
    helicopters: number;
    jets: number;
    antiAir: number;
  };
}

interface Vec3Like {
  x: number;
  y?: number;
  z: number;
}

interface RotationLike {
  yaw: number;
}

interface PlayerRow {
  identity: unknown;
  username: string;
  characterPreset: number;
  pos: Vec3Like;
  rot: RotationLike;
  health: number;
  online: boolean;
  mountedVehicleId: bigint | number;
}

interface VehicleRow {
  entityId: bigint | number;
  vehicleType: number;
  pilotIdentity?: unknown;
}

interface EntityRow {
  id: bigint | number;
  pos: Vec3Like;
  rot: RotationLike;
  active: boolean;
}

interface IterableTable<Row> {
  iter?: () => Iterable<Row>;
}

interface TacticalMapTables {
  player?: IterableTable<PlayerRow>;
  vehicle?: IterableTable<VehicleRow>;
  entity?: IterableTable<EntityRow>;
}

const VEHICLE_MARKER_STYLE: Record<number, { label: string; shortLabel: string; color: string }> = {
  [VEHICLE_TYPES.Helicopter]: { label: 'Helicopter', shortLabel: 'H', color: '#00e5ff' },
  [VEHICLE_TYPES.FighterJet]: { label: 'Fighter Jet', shortLabel: 'J', color: '#ff6b35' },
  [VEHICLE_TYPES.AntiAir]: { label: 'Anti-Air', shortLabel: 'AA', color: '#ffd600' },
};

const DEFAULT_SNAPSHOT: TacticalMapSnapshot = {
  width: WORLD.sizeX,
  height: WORLD.sizeZ,
  players: [],
  vehicles: [],
  selfX: WORLD.sizeX * 0.5,
  selfZ: WORLD.sizeZ * 0.5,
  stats: {
    players: 0,
    vehicles: 0,
    helicopters: 0,
    jets: 0,
    antiAir: 0,
  },
};

function identityToString(value: unknown): string {
  if (value && typeof value === 'object' && 'toHexString' in value && typeof (value as { toHexString: () => string }).toHexString === 'function') {
    return (value as { toHexString: () => string }).toHexString();
  }
  return String(value ?? '');
}

function toNumber(value: bigint | number | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

function clampToWorldX(x: number): number {
  return Math.max(0, Math.min(WORLD.sizeX, Number.isFinite(x) ? x : 0));
}

function clampToWorldZ(z: number): number {
  return Math.max(0, Math.min(WORLD.sizeZ, Number.isFinite(z) ? z : 0));
}

function yawToDegrees(yaw: number): number {
  // Negate to match Engine.ts heading convention (0=North, 90=East compass style)
  return ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
}

export function useTacticalMap(connection: DbConnection | null, identity: string | null, enabled = true) {
  const [snapshot, setSnapshot] = useState<TacticalMapSnapshot>(DEFAULT_SNAPSHOT);

  useEffect(() => {
    if (!connection || !enabled) {
      setSnapshot(DEFAULT_SNAPSHOT);
      return;
    }

    const db = connection.db as unknown as TacticalMapTables;

    const update = () => {
      const entityById = new Map<number, EntityRow>();
      for (const row of db.entity?.iter?.() ?? []) {
        if (!row.active) continue;
        entityById.set(toNumber(row.id), row);
      }

      let selfX = WORLD.sizeX * 0.5;
      let selfZ = WORLD.sizeZ * 0.5;

      const players: TacticalMapPlayer[] = [];
      for (const row of db.player?.iter?.() ?? []) {
        if (!row.online) continue;

        const id = identityToString(row.identity);
        const mountedVehicleId = toNumber(row.mountedVehicleId);
        const mountedEntity = mountedVehicleId !== 0 ? entityById.get(mountedVehicleId) : null;
        const sourcePos = mountedEntity?.pos ?? row.pos;
        const preset = getCharacterPreset(Number(row.characterPreset ?? 0));
        const isSelf = !!identity && id === identity;

        const px = clampToWorldX(Number(sourcePos?.x ?? 0));
        const pz = clampToWorldZ(Number(sourcePos?.z ?? 0));

        if (isSelf) {
          selfX = px;
          selfZ = pz;
        }

        players.push({
          id,
          name: row.username || 'PLAYER',
          x: px,
          z: pz,
          yaw: yawToDegrees(Number(row.rot?.yaw ?? 0)),
          color: colorHex(preset.accentColor),
          isSelf,
          isMounted: mountedVehicleId !== 0,
          alive: Number(row.health ?? 0) > 0,
        });
      }

      players.sort((a, b) => {
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const vehicles: TacticalMapVehicle[] = [];
      let helicopters = 0;
      let jets = 0;
      let antiAir = 0;
      for (const row of db.vehicle?.iter?.() ?? []) {
        const entityId = toNumber(row.entityId);
        const entity = entityById.get(entityId);
        if (!entity) continue;

        const type = Number(row.vehicleType ?? -1);
        const style = VEHICLE_MARKER_STYLE[type] ?? {
          label: 'Vehicle',
          shortLabel: 'V',
          color: '#6b7080',
        };
        if (type === VEHICLE_TYPES.Helicopter) helicopters++;
        if (type === VEHICLE_TYPES.FighterJet) jets++;
        if (type === VEHICLE_TYPES.AntiAir) antiAir++;

        vehicles.push({
          id: entityId,
          type,
          label: style.label,
          shortLabel: style.shortLabel,
          x: clampToWorldX(Number(entity.pos?.x ?? 0)),
          z: clampToWorldZ(Number(entity.pos?.z ?? 0)),
          yaw: yawToDegrees(Number(entity.rot?.yaw ?? 0)),
          occupied: Boolean(row.pilotIdentity),
          color: style.color,
        });
      }

      setSnapshot({
        width: WORLD.sizeX,
        height: WORLD.sizeZ,
        players,
        vehicles,
        selfX,
        selfZ,
        stats: {
          players: players.length,
          vehicles: vehicles.length,
          helicopters,
          jets,
          antiAir,
        },
      });
    };

    update();
    const interval = window.setInterval(update, 120);
    return () => window.clearInterval(interval);
  }, [connection, enabled, identity]);

  return snapshot;
}
