import { useEffect, useState } from 'react';
import type { DbConnection } from '../../module_bindings';
import { getCharacterPreset, colorHex } from '../../characterPresets';
import { ABILITY_COLORS, ABILITY_NAMES } from '../../game/AbilityPickupManager';
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

export interface TacticalMapMarker {
  id: string;
  label: string;
  x: number;
  z: number;
  color: string;
  kind: 'pickup' | 'zone';
}

export interface TacticalMapSnapshot {
  width: number;
  height: number;
  players: TacticalMapPlayer[];
  vehicles: TacticalMapVehicle[];
  markers: TacticalMapMarker[];
  stats: {
    players: number;
    vehicles: number;
    helicopters: number;
    jets: number;
    antiAir: number;
    pickups: number;
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

interface AbilityPickupRow {
  id: bigint | number;
  abilityType: number;
  pos: Vec3Like;
  active: boolean;
}

interface IterableTable<Row> {
  iter?: () => Iterable<Row>;
}

interface TacticalMapTables {
  player?: IterableTable<PlayerRow>;
  vehicle?: IterableTable<VehicleRow>;
  entity?: IterableTable<EntityRow>;
  ability_pickup?: IterableTable<AbilityPickupRow>;
}

const VEHICLE_MARKER_STYLE: Record<number, { label: string; shortLabel: string; color: string }> = {
  [VEHICLE_TYPES.Helicopter]: { label: 'Helicopter', shortLabel: 'H', color: '#7cf6ff' },
  [VEHICLE_TYPES.FighterJet]: { label: 'Fighter Jet', shortLabel: 'J', color: '#ff8f5a' },
  [VEHICLE_TYPES.AntiAir]: { label: 'Anti-Air', shortLabel: 'AA', color: '#ffe66d' },
};

const DEFAULT_SNAPSHOT: TacticalMapSnapshot = {
  width: WORLD.sizeX,
  height: WORLD.sizeZ,
  players: [],
  vehicles: [],
  markers: [],
  stats: {
    players: 0,
    vehicles: 0,
    helicopters: 0,
    jets: 0,
    antiAir: 0,
    pickups: 0,
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
  return ((yaw * 180) / Math.PI + 360) % 360;
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

      const players: TacticalMapPlayer[] = [];
      for (const row of db.player?.iter?.() ?? []) {
        if (!row.online) continue;

        const id = identityToString(row.identity);
        const mountedVehicleId = toNumber(row.mountedVehicleId);
        const mountedEntity = mountedVehicleId !== 0 ? entityById.get(mountedVehicleId) : null;
        const sourcePos = mountedEntity?.pos ?? row.pos;
        const preset = getCharacterPreset(Number(row.characterPreset ?? 0));

        players.push({
          id,
          name: row.username || 'PLAYER',
          x: clampToWorldX(Number(sourcePos?.x ?? 0)),
          z: clampToWorldZ(Number(sourcePos?.z ?? 0)),
          yaw: yawToDegrees(Number(row.rot?.yaw ?? 0)),
          color: colorHex(preset.accentColor),
          isSelf: !!identity && id === identity,
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
          color: '#c9d6df',
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

      const markers: TacticalMapMarker[] = [
        {
          id: 'center-grid',
          label: 'CENTER GRID',
          x: WORLD.sizeX * 0.5,
          z: WORLD.sizeZ * 0.5,
          color: '#ffd166',
          kind: 'zone',
        },
      ];

      for (const row of db.ability_pickup?.iter?.() ?? []) {
        if (!row.active) continue;
        const colorValue = ABILITY_COLORS[Number(row.abilityType ?? -1)] ?? 0xffffff;
        markers.push({
          id: `pickup-${String(row.id)}`,
          label: ABILITY_NAMES[Number(row.abilityType ?? -1)] ?? 'Support',
          x: clampToWorldX(Number(row.pos?.x ?? 0)),
          z: clampToWorldZ(Number(row.pos?.z ?? 0)),
          color: colorHex(colorValue),
          kind: 'pickup',
        });
      }

      setSnapshot({
        width: WORLD.sizeX,
        height: WORLD.sizeZ,
        players,
        vehicles,
        markers,
        stats: {
          players: players.length,
          vehicles: vehicles.length,
          helicopters,
          jets,
          antiAir,
          pickups: Math.max(0, markers.length - 1),
        },
      });
    };

    update();
    const interval = window.setInterval(update, 120);
    return () => window.clearInterval(interval);
  }, [connection, enabled, identity]);

  return snapshot;
}
