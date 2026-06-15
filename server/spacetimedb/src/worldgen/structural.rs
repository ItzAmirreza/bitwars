// ── Structural Integrity (Support-Chain Settling) ──
// Works on sparse chunk windows and produces deterministic, server-authoritative
// settle moves. After blocks are destroyed, this finds blocks that no longer have
// a continuous chain of support down to an anchor (the world floor, an external
// solid block, or an unloaded chunk boundary) and drops each of them straight
// down — sand/gravel style — until it rests on the first solid surface beneath it.
//
// Support is resolved with a flood-fill from the ground anchors: a block survives
// only if it can be reached from an anchor through a chain of solid neighbours.
// Anything unreachable is unsupported and falls. This is correct for support
// chains (cut a key support and everything that depended on it through the chain
// falls) and, because the fill is global over the affected structure, it never
// leaves a fragment hanging on a block that is itself about to fall.
//
// A bounded cascade loop re-seeds from the cells blocks vacate, so a collapse that
// removes the support for a *further* section is re-evaluated rather than leaving
// it floating. The server owns every landing position, so the final world state is
// identical for all clients.

use super::*;
use std::collections::{HashMap, HashSet};

/// Per-BFS node ceiling while gathering the affected structure around a seed.
const MAX_BFS_NODES: usize = 20000;
/// Radius (in blocks) a single gather BFS reaches from its seed.
const MAX_BFS_RADIUS: i32 = 36;
/// Hard cap on the number of blocks that can settle from a single destruction,
/// bounding reducer work and event payload size. Excess unsupported blocks are
/// left in place (still solid) rather than processed this pass.
const MAX_SETTLE_MOVES: usize = 512;
/// Deepest a single block may fall while settling, bounding the search.
const MAX_SETTLE_DROP: i32 = 64;
/// Maximum number of cascade rounds. Each round settles the blocks unsupported by
/// the previous round's collapse, so chained failures resolve in one destruction
/// event instead of leaving floaters behind.
const MAX_CASCADE_ITERS: usize = 8;

const N6: [(i32, i32, i32); 6] = [
    (1, 0, 0),
    (-1, 0, 0),
    (0, 1, 0),
    (0, -1, 0),
    (0, 0, 1),
    (0, 0, -1),
];

fn pack_coord(x: i32, y: i32, z: i32) -> u64 {
    ((x as u64) & 0x3FF) | (((y as u64) & 0xFF) << 10) | (((z as u64) & 0x3FF) << 18)
}

fn block_in_world(x: i32, y: i32, z: i32) -> bool {
    x >= 0
        && (x as usize) < WORLD_SIZE_X
        && y >= 0
        && (y as usize) < WORLD_SIZE_Y
        && z >= 0
        && (z as usize) < WORLD_SIZE_Z
}

fn get_block_sparse(chunks: &HashMap<u32, [u8; 4096]>, x: i32, y: i32, z: i32) -> Option<u8> {
    if !block_in_world(x, y, z) {
        return Some(AIR);
    }
    let cx = (x / CHUNK_SIZE as i32) as u8;
    let cy = (y / CHUNK_SIZE as i32) as u8;
    let cz = (z / CHUNK_SIZE as i32) as u8;
    let chunk_id = pack_chunk_id(cx, cy, cz);
    if let Some(data) = chunks.get(&chunk_id) {
        let lx = (x % CHUNK_SIZE as i32) as usize;
        let ly = (y % CHUNK_SIZE as i32) as usize;
        let lz = (z % CHUNK_SIZE as i32) as usize;
        Some(data[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE])
    } else {
        None // Chunk not loaded — treat as unknown
    }
}

/// Read a block, honouring an in-progress settle overlay so the cascade sees the
/// effect of earlier rounds (cells that have been vacated read as `AIR`; cells a
/// block has landed in read as that block). Falls back to the chunk window.
fn get_block_effective(
    chunks: &HashMap<u32, [u8; 4096]>,
    overlay: &HashMap<(i32, i32, i32), u8>,
    x: i32,
    y: i32,
    z: i32,
) -> Option<u8> {
    if let Some(&b) = overlay.get(&(x, y, z)) {
        return Some(b);
    }
    get_block_sparse(chunks, x, y, z)
}

/// A single block's vertical relocation: it leaves `(x, from_y, z)` and comes to
/// rest at `(x, to_y, z)`, with `to_y < from_y` always.
pub struct SettleMove {
    pub x: i32,
    pub z: i32,
    pub from_y: i32,
    pub to_y: i32,
    pub block_type: u8,
}

/// Flood the connected solid structure touching `frontier` into a single
/// deterministic list. Seeds from the solid neighbours of each frontier cell and
/// shares one `visited` set so overlapping seeds union into one affected set.
/// Bounded per-seed by `MAX_BFS_RADIUS` and globally by `MAX_BFS_NODES`.
fn gather_affected(
    chunks: &HashMap<u32, [u8; 4096]>,
    overlay: &HashMap<(i32, i32, i32), u8>,
    frontier: &[(i32, i32, i32)],
) -> Vec<(i32, i32, i32, u8)> {
    let mut visited: HashSet<u64> = HashSet::new();
    let mut affected: Vec<(i32, i32, i32, u8)> = Vec::new();
    let r2 = MAX_BFS_RADIUS * MAX_BFS_RADIUS;

    for &(px, py, pz) in frontier {
        for &(dx, dy, dz) in &N6 {
            let sx = px + dx;
            let sy = py + dy;
            let sz = pz + dz;
            if !block_in_world(sx, sy, sz) {
                continue;
            }
            let skey = pack_coord(sx, sy, sz);
            if visited.contains(&skey) {
                continue;
            }
            match get_block_effective(chunks, overlay, sx, sy, sz) {
                Some(b) if b != AIR => {}
                _ => continue,
            }

            // BFS this component from the seed, radius measured from the seed.
            let mut queue = vec![(sx, sy, sz)];
            let mut q_head = 0;
            visited.insert(skey);

            while q_head < queue.len() && affected.len() < MAX_BFS_NODES {
                let (x, y, z) = queue[q_head];
                q_head += 1;

                let ddx = x - sx;
                let ddy = y - sy;
                let ddz = z - sz;
                if ddx * ddx + ddy * ddy + ddz * ddz > r2 {
                    continue;
                }

                let bt = match get_block_effective(chunks, overlay, x, y, z) {
                    Some(b) => b,
                    None => continue,
                };
                if bt == AIR {
                    continue;
                }

                affected.push((x, y, z, bt));

                for &(ox, oy, oz) in &N6 {
                    let nx = x + ox;
                    let ny = y + oy;
                    let nz = z + oz;
                    if !block_in_world(nx, ny, nz) {
                        continue;
                    }
                    let nkey = pack_coord(nx, ny, nz);
                    if visited.contains(&nkey) {
                        continue;
                    }
                    match get_block_effective(chunks, overlay, nx, ny, nz) {
                        Some(b) if b != AIR => {
                            visited.insert(nkey);
                            queue.push((nx, ny, nz));
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    affected
}

/// From the gathered structure, return the blocks that have no support chain to an
/// anchor. Anchors are blocks that rest on the world floor (`y == 0`), on an
/// external solid block (one outside the gathered set — terrain we didn't or
/// couldn't traverse), or on an unloaded chunk (treated conservatively as support
/// so we never collapse across a streaming boundary). Support then propagates
/// through solid N6 connectivity: any gathered block reachable from an anchor is
/// supported, everything else falls. Result is sorted bottom-up for a stable,
/// deterministic settle.
fn find_unsupported(
    chunks: &HashMap<u32, [u8; 4096]>,
    overlay: &HashMap<(i32, i32, i32), u8>,
    affected: &[(i32, i32, i32, u8)],
) -> Vec<(i32, i32, i32, u8)> {
    if affected.is_empty() {
        return Vec::new();
    }

    let affected_set: HashSet<(i32, i32, i32)> =
        affected.iter().map(|&(x, y, z, _)| (x, y, z)).collect();

    // Seed the support flood-fill from every externally-anchored block.
    let mut anchored: HashSet<(i32, i32, i32)> = HashSet::new();
    let mut queue: Vec<(i32, i32, i32)> = Vec::new();
    for &(x, y, z, _) in affected {
        let is_anchor = if y == 0 {
            true
        } else {
            match get_block_effective(chunks, overlay, x, y - 1, z) {
                None => true, // unloaded below → assume support
                Some(b) if b != AIR && !affected_set.contains(&(x, y - 1, z)) => true, // external solid
                _ => false,
            }
        };
        if is_anchor && anchored.insert((x, y, z)) {
            queue.push((x, y, z));
        }
    }

    // Propagate support through solid connectivity within the affected structure.
    let mut head = 0;
    while head < queue.len() {
        let (x, y, z) = queue[head];
        head += 1;
        for &(ox, oy, oz) in &N6 {
            let nc = (x + ox, y + oy, z + oz);
            if affected_set.contains(&nc) && anchored.insert(nc) {
                queue.push(nc);
            }
        }
    }

    let mut unsupported: Vec<(i32, i32, i32, u8)> = affected
        .iter()
        .copied()
        .filter(|&(x, y, z, _)| !anchored.contains(&(x, y, z)))
        .collect();

    // Lowest blocks first so stacks resolve cleanly, then x/z for a stable tie-break.
    unsupported.sort_by(|a, b| {
        a.1.cmp(&b.1)
            .then_with(|| a.0.cmp(&b.0))
            .then_with(|| a.2.cmp(&b.2))
    });
    unsupported
}

/// Drop each unsupported block straight down to its resting cell, recording the
/// move. The overlay is updated in place — vacated origins become `AIR`, landed
/// cells become solid — so a later cascade round and later blocks in this batch
/// observe the new surface.
fn settle_batch(
    chunks: &HashMap<u32, [u8; 4096]>,
    overlay: &mut HashMap<(i32, i32, i32), u8>,
    unsupported: &[(i32, i32, i32, u8)],
) -> Vec<SettleMove> {
    // Original cells of this batch — falling siblings are not support for one another.
    let mobile_set: HashSet<(i32, i32, i32)> =
        unsupported.iter().map(|&(x, y, z, _)| (x, y, z)).collect();

    // Vacate every origin up front so the descent reads air where blocks have left.
    for &(x, y, z, _) in unsupported {
        overlay.insert((x, y, z), AIR);
    }

    // Cells already claimed by earlier-settled blocks this batch.
    let mut occupied: HashSet<(i32, i32, i32)> = HashSet::new();
    let mut moves = Vec::with_capacity(unsupported.len());

    for &(x, from_y, z, bt) in unsupported {
        let mut to_y = from_y;
        let mut drop = 0;
        while to_y > 0 && drop < MAX_SETTLE_DROP {
            let below_y = to_y - 1;
            let supported = occupied.contains(&(x, below_y, z))
                || (!mobile_set.contains(&(x, below_y, z))
                    && match get_block_effective(chunks, overlay, x, below_y, z) {
                        Some(b) => b != AIR,
                        None => true, // unknown → solid floor for the fall
                    });
            if supported {
                break;
            }
            to_y = below_y;
            drop += 1;
        }
        occupied.insert((x, to_y, z));
        overlay.insert((x, to_y, z), bt); // land in the overlay so the cascade sees it
        if to_y != from_y {
            moves.push(SettleMove {
                x,
                z,
                from_y,
                to_y,
                block_type: bt,
            });
        }
    }

    moves
}

/// Find unsupported blocks near the destroyed cells and compute their
/// deterministic vertical settle, cascading so that collapses which remove the
/// support for further sections are re-evaluated. Each returned `SettleMove`
/// relocates one block straight down to where it comes to rest. Processing is
/// fully deterministic (fixed scan order + bottom-up settle), so every client that
/// replays these moves reaches the same final world state.
pub fn compute_settle_moves(
    chunks: &HashMap<u32, [u8; 4096]>,
    destroyed_positions: &[(i32, i32, i32)],
) -> Vec<SettleMove> {
    // Overlay of in-progress changes layered over the read-only chunk window.
    let mut overlay: HashMap<(i32, i32, i32), u8> = HashMap::new();
    let mut all_moves: Vec<SettleMove> = Vec::new();
    let mut frontier: Vec<(i32, i32, i32)> = destroyed_positions.to_vec();

    for _ in 0..MAX_CASCADE_ITERS {
        if frontier.is_empty() || all_moves.len() >= MAX_SETTLE_MOVES {
            break;
        }

        let affected = gather_affected(chunks, &overlay, &frontier);
        if affected.is_empty() {
            break;
        }

        let mut unsupported = find_unsupported(chunks, &overlay, &affected);
        if unsupported.is_empty() {
            break;
        }

        // Respect the global budget; bottom-up sort means we keep the lowest blocks.
        let remaining = MAX_SETTLE_MOVES - all_moves.len();
        if unsupported.len() > remaining {
            unsupported.truncate(remaining);
        }

        let batch = settle_batch(chunks, &mut overlay, &unsupported);
        if batch.is_empty() {
            break;
        }

        // The cells blocks vacated may have been the support for neighbours above
        // them — re-seed the next cascade round from there.
        frontier = batch.iter().map(|m| (m.x, m.from_y, m.z)).collect();
        all_moves.extend(batch);
    }

    all_moves
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a single-chunk window (chunk 0,0,0) from a list of solid blocks.
    fn window(solids: &[(i32, i32, i32, u8)]) -> HashMap<u32, [u8; 4096]> {
        let mut data = [AIR; 4096];
        for &(x, y, z, bt) in solids {
            let idx = (x as usize % CHUNK_SIZE)
                + (y as usize % CHUNK_SIZE) * CHUNK_SIZE
                + (z as usize % CHUNK_SIZE) * CHUNK_SIZE * CHUNK_SIZE;
            data[idx] = bt;
        }
        let mut chunks = HashMap::new();
        chunks.insert(pack_chunk_id(0, 0, 0), data);
        chunks
    }

    #[test]
    fn floating_block_settles_onto_the_floor() {
        // A lone block at y=5 with a solid pad at y=0 directly below it, and a
        // destroyed cell next to it to seed the scan.
        let chunks = window(&[(5, 0, 5, CONCRETE), (5, 5, 5, BRICK)]);
        let moves = compute_settle_moves(&chunks, &[(6, 5, 5)]);

        assert_eq!(moves.len(), 1);
        let m = &moves[0];
        assert_eq!((m.x, m.z, m.from_y, m.to_y), (5, 5, 5, 1));
        assert_eq!(m.block_type, BRICK);
    }

    #[test]
    fn supported_block_does_not_settle() {
        // A block resting directly on the floor is supported — nothing falls.
        let chunks = window(&[(5, 0, 5, CONCRETE), (5, 1, 5, BRICK)]);
        let moves = compute_settle_moves(&chunks, &[(6, 1, 5)]);
        assert!(moves.is_empty());
    }

    #[test]
    fn stacked_floating_blocks_settle_into_a_pile() {
        // Two stacked floating blocks fall and stack back up on the floor.
        let chunks = window(&[(5, 0, 5, CONCRETE), (5, 6, 5, BRICK), (5, 7, 5, STONE)]);
        let mut moves = compute_settle_moves(&chunks, &[(6, 6, 5), (6, 7, 5)]);
        moves.sort_by_key(|m| m.to_y);

        assert_eq!(moves.len(), 2);
        assert_eq!((moves[0].to_y, moves[0].block_type), (1, BRICK));
        assert_eq!((moves[1].to_y, moves[1].block_type), (2, STONE));
    }

    #[test]
    fn settling_is_deterministic() {
        let chunks = window(&[(5, 0, 5, CONCRETE), (5, 6, 5, BRICK), (5, 7, 5, STONE)]);
        let a = compute_settle_moves(&chunks, &[(6, 6, 5), (6, 7, 5)]);
        let b = compute_settle_moves(&chunks, &[(6, 6, 5), (6, 7, 5)]);
        let key = |m: &SettleMove| (m.x, m.z, m.from_y, m.to_y, m.block_type);
        assert_eq!(
            a.iter().map(key).collect::<Vec<_>>(),
            b.iter().map(key).collect::<Vec<_>>()
        );
    }

    #[test]
    fn grounded_cantilever_stays_up() {
        // A horizontal beam (y=2) whose left end sits on a pillar grounded at y=0.
        // Destroying a cell beside the free (right) end must NOT collapse it: the
        // beam still has a support chain to the ground through the pillar.
        let chunks = window(&[
            (3, 0, 5, CONCRETE), // pillar
            (3, 1, 5, CONCRETE),
            (3, 2, 5, BRICK), // beam
            (4, 2, 5, BRICK),
            (5, 2, 5, BRICK),
        ]);
        let moves = compute_settle_moves(&chunks, &[(6, 2, 5)]);
        assert!(moves.is_empty(), "grounded cantilever should not fall");
    }

    #[test]
    fn severing_the_support_chain_drops_the_whole_section() {
        // A pillar with its base block already gone (it was just destroyed): the
        // remaining stack at y=2..4 is disconnected from the floor, so the entire
        // section must settle straight down rather than hang in the air. This is
        // the floating-blocks bug the old per-component heuristic missed.
        let chunks = window(&[
            (5, 2, 5, CONCRETE),
            (5, 3, 5, CONCRETE),
            (5, 4, 5, BRICK),
        ]);
        let moves = compute_settle_moves(&chunks, &[(5, 1, 5)]);

        assert_eq!(moves.len(), 3);
        let mut landed: Vec<i32> = moves.iter().map(|m| m.to_y).collect();
        landed.sort();
        assert_eq!(landed, vec![0, 1, 2]);
    }

    #[test]
    fn horizontally_linked_floater_collapses() {
        // Column A (x=5, y=3) hangs off a horizontal link (y=2) to a stub at x=6
        // whose own base has just been destroyed. With no chain to the ground left,
        // the link, the stub and column A must all fall — none may be left floating.
        let chunks = window(&[
            (6, 2, 5, CONCRETE), // stub, base just removed below it
            (5, 2, 5, BRICK),    // horizontal link
            (5, 3, 5, BRICK),    // column A, floating above the floor
        ]);
        let moves = compute_settle_moves(&chunks, &[(6, 1, 5)]);

        assert!(!moves.is_empty());
        for m in &moves {
            assert!(
                m.to_y < m.from_y,
                "block at ({}, {}, {}) did not fall",
                m.x,
                m.from_y,
                m.z
            );
        }
        assert!(
            moves.iter().any(|m| m.x == 5 && m.from_y == 3),
            "column A capstone was left floating"
        );
    }
}
