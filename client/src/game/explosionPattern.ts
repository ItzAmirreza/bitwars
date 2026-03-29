export interface ExplosionCoord {
  x: number;
  y: number;
  z: number;
}

export function collectCappedEllipsoidCoords(
  center: ExplosionCoord,
  horizontalRadius: number,
  verticalRadius: number,
  maxCandidates: number,
  inBounds: (x: number, y: number, z: number) => boolean,
): ExplosionCoord[] {
  const hr = Math.max(horizontalRadius, 0.1);
  const vr = Math.max(verticalRadius, 0.1);
  const hr2 = hr * hr;
  const vr2 = vr * vr;
  const candidates: Array<{ coord: ExplosionCoord; normalizedDistance: number }> = [];

  for (let x = Math.floor(center.x - hr); x <= Math.ceil(center.x + hr); x++) {
    for (let y = Math.floor(center.y - vr); y <= Math.ceil(center.y + vr); y++) {
      for (let z = Math.floor(center.z - hr); z <= Math.ceil(center.z + hr); z++) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const normalizedDistance = (dx * dx + dz * dz) / hr2 + (dy * dy) / vr2;
        if (normalizedDistance <= 1.0 && inBounds(x, y, z)) {
          candidates.push({ coord: { x, y, z }, normalizedDistance });
        }
      }
    }
  }

  candidates.sort((a, b) =>
    a.normalizedDistance - b.normalizedDistance
    || a.coord.x - b.coord.x
    || a.coord.y - b.coord.y
    || a.coord.z - b.coord.z,
  );

  return candidates.slice(0, maxCandidates).map((entry) => entry.coord);
}
