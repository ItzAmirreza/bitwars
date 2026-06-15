// ── Structural Integrity (Unsupported-Block Settling) ──
// Works on sparse chunk windows and produces deterministic, server-authoritative
// settle moves. After blocks are destroyed, this finds connected components that
// are no longer attached to any support (the ground or an external solid block)
// and drops each unsupported block straight down — sand/gravel style — until it
// rests on the first solid surface beneath it. The server owns every landing
// position, so the final world state is identical for all clients.

use super::*;
use std::collections::{HashMap, HashSet};

const MAX_BFS_NODES: usize = 20000;
const MAX_BFS_RADIUS: i32 = 36;
/// Hard cap on the number of blocks that can settle from a single destruction,
/// bounding reducer work and event payload size. Excess unsupported blocks are
/// left in place (still solid) rather than processed this pass.
const MAX_SETTLE_MOVES: usize = 512;
/// Deepest a single block may fall while settling, bounding the search.
const MAX_SETTLE_DROP: i32 = 64;

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

/// A single block's vertical relocation: it leaves `(x, from_y, z)` and comes to
/// rest at `(x, to_y, z)`, with `to_y < from_y` always.
pub struct SettleMove {
    pub x: i32,
    pub z: i32,
    pub from_y: i32,
    pub to_y: i32,
    pub block_type: u8,
}

struct ComponentScan {
    blocks: Vec<(i32, i32, i32, u8)>,
    visited: Vec<u64>,
}

fn scan_component_sparse(
    chunks: &HashMap<u32, [u8; 4096]>,
    start_x: i32,
    start_y: i32,
    start_z: i32,
    global_visited: &HashSet<u64>,
) -> ComponentScan {
    let mut queue = vec![(start_x, start_y, start_z)];
    let mut visited = Vec::new();
    let mut result_blocks = Vec::new();
    let mut local_visited = HashSet::new();
    let mut q_head = 0;

    let start_key = pack_coord(start_x, start_y, start_z);
    local_visited.insert(start_key);
    visited.push(start_key);

    let r2 = MAX_BFS_RADIUS * MAX_BFS_RADIUS;

    while q_head < queue.len() && result_blocks.len() < MAX_BFS_NODES {
        let (x, y, z) = queue[q_head];
        q_head += 1;

        let dx = x - start_x;
        let dy = y - start_y;
        let dz = z - start_z;
        if dx * dx + dy * dy + dz * dz > r2 {
            continue;
        }

        let bt = match get_block_sparse(chunks, x, y, z) {
            Some(b) => b,
            None => {
                continue;
            }
        };
        if bt == AIR {
            continue;
        }

        result_blocks.push((x, y, z, bt));

        for &(ox, oy, oz) in &N6 {
            let nx = x + ox;
            let ny = y + oy;
            let nz = z + oz;
            if !block_in_world(nx, ny, nz) {
                continue;
            }

            let nkey = pack_coord(nx, ny, nz);
            if local_visited.contains(&nkey) || global_visited.contains(&nkey) {
                continue;
            }

            match get_block_sparse(chunks, nx, ny, nz) {
                Some(b) if b != AIR => {
                    local_visited.insert(nkey);
                    visited.push(nkey);
                    queue.push((nx, ny, nz));
                }
                None => {}
                Some(_) => {}
            }
        }
    }

    ComponentScan {
        blocks: result_blocks,
        visited,
    }
}

/// True if the component rests on something solid: a block sitting on the world
/// floor (`y == 0`), a solid block directly beneath a component block that is
/// NOT itself part of the component, or an unloaded chunk below (treated
/// conservatively as support so we never collapse across a streaming boundary).
fn component_is_supported(
    chunks: &HashMap<u32, [u8; 4096]>,
    component: &ComponentScan,
) -> bool {
    let mut block_keys = HashSet::new();
    for &(x, y, z, _) in &component.blocks {
        block_keys.insert(pack_coord(x, y, z));
    }

    for &(x, y, z, _) in &component.blocks {
        if y == 0 {
            return true;
        }
        let below_key = pack_coord(x, y - 1, z);
        if block_keys.contains(&below_key) {
            continue; // supported by another block in the same component
        }
        match get_block_sparse(chunks, x, y - 1, z) {
            Some(b) if b != AIR => return true, // rests on an external solid block
            None => return true,                // unknown below → assume support
            Some(_) => {}
        }
    }

    false
}

/// Find unsupported components near the destroyed cells and compute their
/// deterministic vertical settle. Each returned `SettleMove` relocates one block
/// straight down to where it comes to rest. Processing is fully deterministic
/// (fixed scan order + bottom-up settle), so every client that replays these
/// moves reaches the same final world state.
pub fn compute_settle_moves(
    chunks: &HashMap<u32, [u8; 4096]>,
    destroyed_positions: &[(i32, i32, i32)],
) -> Vec<SettleMove> {
    let mut global_visited = HashSet::new();
    let mut mobile: Vec<(i32, i32, i32, u8)> = Vec::new();

    'outer: for &(px, py, pz) in destroyed_positions {
        for &(dx, dy, dz) in &N6 {
            let nx = px + dx;
            let ny = py + dy;
            let nz = pz + dz;
            if !block_in_world(nx, ny, nz) {
                continue;
            }
            let bt = match get_block_sparse(chunks, nx, ny, nz) {
                Some(b) => b,
                None => continue,
            };
            if bt == AIR {
                continue;
            }
            let key = pack_coord(nx, ny, nz);
            if global_visited.contains(&key) {
                continue;
            }

            let comp = scan_component_sparse(chunks, nx, ny, nz, &global_visited);
            for &k in &comp.visited {
                global_visited.insert(k);
            }

            if component_is_supported(chunks, &comp) {
                continue;
            }

            for b in &comp.blocks {
                mobile.push(*b);
                if mobile.len() >= MAX_SETTLE_MOVES {
                    break 'outer;
                }
            }
        }
    }

    if mobile.is_empty() {
        return Vec::new();
    }

    // Deterministic settle order: lowest blocks first so stacks resolve cleanly,
    // then x/z for a stable tie-break.
    mobile.sort_by(|a, b| {
        a.1.cmp(&b.1)
            .then_with(|| a.0.cmp(&b.0))
            .then_with(|| a.2.cmp(&b.2))
    });

    let mobile_set: HashSet<(i32, i32, i32)> =
        mobile.iter().map(|&(x, y, z, _)| (x, y, z)).collect();

    // Cells that stop a falling block: targets already claimed by earlier-settled
    // blocks this pass.
    let mut occupied: HashSet<(i32, i32, i32)> = HashSet::new();

    let mut moves = Vec::with_capacity(mobile.len());
    for &(x, from_y, z, bt) in &mobile {
        let mut to_y = from_y;
        let mut drop = 0;
        while to_y > 0 && drop < MAX_SETTLE_DROP {
            let below_y = to_y - 1;
            let supported = occupied.contains(&(x, below_y, z))
                || (!mobile_set.contains(&(x, below_y, z))
                    && match get_block_sparse(chunks, x, below_y, z) {
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
}
