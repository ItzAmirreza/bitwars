// ── World Generation ──
// Ported from client/src/game/VoxelWorld.ts generateTerrain()

pub const WORLD_SIZE_X: usize = 128;
pub const WORLD_SIZE_Y: usize = 48;
pub const WORLD_SIZE_Z: usize = 128;
pub const CHUNK_SIZE: usize = 16;
pub const NUM_CHUNKS_X: usize = WORLD_SIZE_X / CHUNK_SIZE; // 8
pub const NUM_CHUNKS_Y: usize = WORLD_SIZE_Y / CHUNK_SIZE; // 3
pub const NUM_CHUNKS_Z: usize = WORLD_SIZE_Z / CHUNK_SIZE; // 8

// Block types (must match client BlockType)
pub const AIR: u8 = 0;
pub const CONCRETE: u8 = 1;
pub const DARK_CONCRETE: u8 = 2;
pub const ASPHALT: u8 = 3;
pub const REBAR: u8 = 4;
pub const BRICK: u8 = 5;
pub const METAL: u8 = 6;
pub const RUBBLE: u8 = 7;
pub const DIRT: u8 = 8;
pub const SAND: u8 = 9;

// ── Noise helpers ──

fn hash2d(x: i32, z: i32) -> f64 {
    let mut h: i32 = x.wrapping_mul(374761393).wrapping_add(z.wrapping_mul(668265263));
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    ((h ^ (h >> 16)) & 0x7fffffff) as f64 / 0x7fffffff as f64
}

fn sm(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn lrp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn vnoise(x: f64, z: f64) -> f64 {
    let ix = x.floor() as i32;
    let iz = z.floor() as i32;
    let fx = sm(x - ix as f64);
    let fz = sm(z - iz as f64);
    lrp(
        lrp(hash2d(ix, iz), hash2d(ix + 1, iz), fx),
        lrp(hash2d(ix, iz + 1), hash2d(ix + 1, iz + 1), fx),
        fz,
    )
}

fn fbm(mut x: f64, mut z: f64, oct: usize) -> f64 {
    let mut v = 0.0;
    let mut a = 1.0;
    let mut m = 0.0;
    for _ in 0..oct {
        v += vnoise(x, z) * a;
        m += a;
        a *= 0.5;
        x *= 2.0;
        z *= 2.0;
    }
    v / m
}

// ── Block access helpers ──

fn idx(x: usize, y: usize, z: usize) -> usize {
    x + y * WORLD_SIZE_X + z * WORLD_SIZE_X * WORLD_SIZE_Y
}

fn in_bounds(x: i32, y: i32, z: i32) -> bool {
    x >= 0 && (x as usize) < WORLD_SIZE_X && y >= 0 && (y as usize) < WORLD_SIZE_Y && z >= 0 && (z as usize) < WORLD_SIZE_Z
}

fn set_block(blocks: &mut [u8], x: i32, y: i32, z: i32, bt: u8) {
    if in_bounds(x, y, z) {
        blocks[idx(x as usize, y as usize, z as usize)] = bt;
    }
}

fn get_block(blocks: &[u8], x: i32, y: i32, z: i32) -> u8 {
    if in_bounds(x, y, z) {
        blocks[idx(x as usize, y as usize, z as usize)]
    } else {
        AIR
    }
}

// ── Height function ──

fn height_at(x: i32, z: i32) -> i32 {
    let nx = x as f64 / WORLD_SIZE_X as f64;
    let nz = z as f64 / WORLD_SIZE_Z as f64;

    let mut h = 4.0 + fbm(nx * 3.0 + 0.5, nz * 3.0 + 0.5, 4) * 3.0;
    h += fbm(nx * 6.0 + 50.0, nz * 6.0 + 50.0, 4) * 1.5;

    // Slight elevation near edges
    let edge = (x.min(z).min(WORLD_SIZE_X as i32 - 1 - x).min(WORLD_SIZE_Z as i32 - 1 - z)) as f64 / 20.0;
    let ef = 1.0 - edge.min(1.0);
    h += ef * ef * 4.0;

    // Flat spawn area at center
    let dx = x as f64 - WORLD_SIZE_X as f64 / 2.0;
    let dz = z as f64 - WORLD_SIZE_Z as f64 / 2.0;
    let cd = (dx * dx + dz * dz).sqrt();
    if cd < 18.0 {
        h = lrp(5.0, h, sm(cd / 18.0));
    }

    (h.max(2.0).min(12.0)).floor() as i32
}

// ── Terrain Generation ──

pub fn generate_world() -> Vec<u8> {
    let total = WORLD_SIZE_X * WORLD_SIZE_Y * WORLD_SIZE_Z;
    let mut blocks = vec![0u8; total];

    // Phase 1: base terrain
    for x in 0..WORLD_SIZE_X as i32 {
        for z in 0..WORLD_SIZE_Z as i32 {
            let h = height_at(x, z);
            for y in 0..=h {
                let bt = if y <= 1 {
                    DARK_CONCRETE
                } else if y < h - 1 {
                    CONCRETE
                } else {
                    ASPHALT
                };
                set_block(&mut blocks, x, y, z, bt);
            }
        }
    }

    // Phase 2: roads
    build_roads(&mut blocks);

    // Phase 3: craters
    build_craters(&mut blocks);

    // Phase 4: structures
    place_structures(&mut blocks);

    // Phase 5: rubble piles
    build_rubble_piles(&mut blocks);

    // Phase 6: barricades
    build_barricades(&mut blocks);

    // Phase 7: vehicle husks
    build_vehicles(&mut blocks);

    blocks
}

// ── Roads ──

fn build_roads(blocks: &mut [u8]) {
    let road_positions = [40, 64, 88];
    let road_half = 1; // floor(3/2)

    // N-S roads
    for &rx in &road_positions {
        for z in 0..WORLD_SIZE_Z as i32 {
            for w in -road_half..=road_half {
                let x = rx + w;
                if x < 0 || x >= WORLD_SIZE_X as i32 { continue; }
                let h = height_at(x, z);
                if w == 0 && (z % 8) < 4 {
                    set_block(blocks, x, h, z, SAND); // faded marking
                } else {
                    set_block(blocks, x, h, z, ASPHALT);
                }
            }
        }
    }

    // E-W roads
    for &rz in &road_positions {
        for x in 0..WORLD_SIZE_X as i32 {
            for w in -road_half..=road_half {
                let z = rz + w;
                if z < 0 || z >= WORLD_SIZE_Z as i32 { continue; }
                let h = height_at(x, z);
                if w == 0 && (x % 8) < 4 {
                    set_block(blocks, x, h, z, SAND);
                } else {
                    set_block(blocks, x, h, z, ASPHALT);
                }
            }
        }
    }
}

// ── Craters ──

fn build_craters(blocks: &mut [u8]) {
    let craters: [(i32, i32, i32); 12] = [
        (25, 55, 5), (70, 30, 4), (45, 85, 6), (95, 60, 5),
        (55, 45, 3), (80, 95, 4), (30, 105, 5), (105, 40, 4),
        (60, 75, 6), (15, 80, 3), (90, 15, 4), (50, 110, 5),
    ];

    for (cx, cz, r) in craters {
        for dx in -r..=r {
            for dz in -r..=r {
                let dist = ((dx * dx + dz * dz) as f64).sqrt();
                if dist > r as f64 { continue; }
                let x = cx + dx;
                let z = cz + dz;
                if x < 0 || x >= WORLD_SIZE_X as i32 || z < 0 || z >= WORLD_SIZE_Z as i32 { continue; }

                let depth = ((1.0 - dist / r as f64) * (r as f64 * 0.6)).floor() as i32;
                let surface_h = height_at(x, z);

                // Dig crater
                for y in ((surface_h - depth).max(1) + 1..=surface_h).rev() {
                    set_block(blocks, x, y, z, AIR);
                }

                // Crater floor
                let floor_y = (surface_h - depth).max(1);
                let floor_bt = if dist < r as f64 * 0.6 { DIRT } else { RUBBLE };
                set_block(blocks, x, floor_y, z, floor_bt);

                // Rim buildup
                if dist > r as f64 * 0.7 && dist <= r as f64 {
                    set_block(blocks, x, surface_h + 1, z, RUBBLE);
                }
            }
        }
    }
}

// ── Structures ──

fn place_structures(blocks: &mut [u8]) {
    // Ruined buildings
    build_ruined_building(blocks, 20, 25, 8, 8, 3);
    build_ruined_building(blocks, 48, 55, 10, 8, 4);
    build_ruined_building(blocks, 75, 20, 7, 7, 2);
    build_ruined_building(blocks, 95, 50, 9, 6, 3);
    build_ruined_building(blocks, 35, 90, 8, 10, 4);
    build_ruined_building(blocks, 100, 85, 6, 8, 2);
    build_ruined_building(blocks, 15, 65, 7, 6, 3);
    build_ruined_building(blocks, 70, 100, 10, 10, 3);
    build_ruined_building(blocks, 55, 30, 6, 6, 2);
    build_ruined_building(blocks, 110, 110, 8, 7, 3);

    // Bombed towers
    build_bombed_tower(blocks, 28, 45, 14);
    build_bombed_tower(blocks, 85, 35, 12);
    build_bombed_tower(blocks, 42, 110, 16);
    build_bombed_tower(blocks, 105, 70, 10);
    build_bombed_tower(blocks, 18, 100, 13);

    // Central command post
    build_command_post(blocks, 54, 54);
}

fn build_ruined_building(blocks: &mut [u8], ox: i32, oz: i32, w: i32, d: i32, floors: i32) {
    let base_y = height_at(ox, oz);
    let story_h = 4;
    let total_h = floors * story_h;

    for x in 0..w {
        for z in 0..d {
            for y in 0..total_h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 || by >= WORLD_SIZE_Y as i32 { continue; }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_floor = y > 0 && y % story_h == 0;
                let is_door = (x == w / 2 || x == w / 2 + 1) && z == 0 && y < 3;

                let destruction_chance = hash2d(bx * 17 + by, bz * 31 + by);

                if is_door { continue; }

                if is_floor && !is_wall {
                    if destruction_chance > 0.25 {
                        set_block(blocks, bx, by, bz, CONCRETE);
                    }
                } else if is_wall {
                    let dmg_threshold = if y > story_h * 2 {
                        0.30
                    } else if y > story_h {
                        0.18
                    } else {
                        0.08
                    };
                    if destruction_chance > dmg_threshold {
                        let bt = if destruction_chance > 0.85 { BRICK } else { CONCRETE };
                        set_block(blocks, bx, by, bz, bt);
                    } else if y > total_h - 3 {
                        if hash2d(bx * 3, bz * 5 + by) > 0.5 {
                            set_block(blocks, bx, by, bz, REBAR);
                        }
                    }
                }
            }
        }
    }

    // Rubble around base
    for dx in -2..=(w + 1) {
        for dz in -2..=(d + 1) {
            let bx = ox + dx;
            let bz = oz + dz;
            if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 { continue; }
            if dx >= 0 && dx < w && dz >= 0 && dz < d { continue; }
            if hash2d(bx * 19, bz * 23) < 0.35 {
                let by = height_at(bx, bz) + 1;
                if by < WORLD_SIZE_Y as i32 {
                    set_block(blocks, bx, by, bz, RUBBLE);
                    if hash2d(bx * 7, bz * 11) < 0.2 && by + 1 < WORLD_SIZE_Y as i32 {
                        set_block(blocks, bx, by + 1, bz, RUBBLE);
                    }
                }
            }
        }
    }
}

fn build_bombed_tower(blocks: &mut [u8], ox: i32, oz: i32, height: i32) {
    let base_y = height_at(ox, oz);
    let tw = 5;

    for y in 0..height {
        for x in 0..tw {
            for z in 0..tw {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 || by >= WORLD_SIZE_Y as i32 { continue; }

                let is_wall = x == 0 || x == tw - 1 || z == 0 || z == tw - 1;
                if !is_wall { continue; }

                if y > height - 4 {
                    let keep = hash2d(bx * 13 + y, bz * 7 + y);
                    if keep < 0.4 { continue; }
                    let bt = if keep > 0.8 { REBAR } else { CONCRETE };
                    set_block(blocks, bx, by, bz, bt);
                } else {
                    let collapse_chance = if x == 0 && y > height / 2 { 0.35 } else { 0.05 };
                    if hash2d(bx * 11 + y, bz * 17) > collapse_chance {
                        set_block(blocks, bx, by, bz, CONCRETE);
                    }
                }
            }
        }
    }

    // Platforms at bottom and mid
    for x in 0..tw {
        for z in 0..tw {
            let bx = ox + x;
            let bz = oz + z;
            if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 { continue; }
            set_block(blocks, bx, base_y + 1, bz, DARK_CONCRETE);
            let mid_y = base_y + 1 + height / 2;
            if mid_y < WORLD_SIZE_Y as i32 {
                set_block(blocks, bx, mid_y, bz, CONCRETE);
            }
        }
    }
}

fn build_command_post(blocks: &mut [u8], ox: i32, oz: i32) {
    let base_y = height_at(ox + 10, oz + 10);
    let w = 20;
    let d = 20;
    let h = 6;

    // Main structure
    for y in 0..h {
        for x in 0..w {
            for z in 0..d {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 || by >= WORLD_SIZE_Y as i32 { continue; }

                let outer_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let inner_wall = x == 1 || x == w - 2 || z == 1 || z == d - 2;
                let is_roof = y == h - 1;
                let is_floor = y == 0;

                let is_gate = x >= 8 && x <= 11 && z == 0 && y < 4;
                let is_back_gate = x >= 8 && x <= 11 && z == d - 1 && y < 4;
                if is_gate || is_back_gate { continue; }

                if is_floor {
                    set_block(blocks, bx, by, bz, DARK_CONCRETE);
                } else if is_roof && x > 1 && x < w - 2 && z > 1 && z < d - 2 {
                    if hash2d(bx * 11, bz * 13) > 0.3 {
                        set_block(blocks, bx, by, bz, CONCRETE);
                    }
                } else if outer_wall {
                    let dmg = hash2d(bx * 7 + y, bz * 11);
                    if dmg > 0.12 {
                        set_block(blocks, bx, by, bz, CONCRETE);
                    }
                } else if inner_wall && (x <= 1 || x >= w - 2 || z <= 1 || z >= d - 2) {
                    set_block(blocks, bx, by, bz, CONCRETE);
                }
            }
        }
    }

    // Corner watchtowers
    let corners = [(0, 0), (w - 4, 0), (0, d - 4), (w - 4, d - 4)];
    for (cx, cz) in corners {
        for y in 0..(h + 3) {
            for x in 0..4 {
                for z in 0..4 {
                    let bx = ox + cx + x;
                    let bz = oz + cz + z;
                    let by = base_y + 1 + y;
                    if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 || by >= WORLD_SIZE_Y as i32 { continue; }
                    let is_edge = x == 0 || x == 3 || z == 0 || z == 3;
                    if is_edge {
                        set_block(blocks, bx, by, bz, DARK_CONCRETE);
                    }
                    if y == h + 2 {
                        set_block(blocks, bx, by, bz, CONCRETE);
                    }
                }
            }
        }
    }

    // Sandbag perimeter
    for x in -2..=(w + 1) {
        for z in -2..=(d + 1) {
            if x >= 0 && x < w && z >= 0 && z < d { continue; }
            let bx = ox + x;
            let bz = oz + z;
            if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 { continue; }
            if hash2d(bx * 23, bz * 29) < 0.3 {
                let by = height_at(bx, bz) + 1;
                if by < WORLD_SIZE_Y as i32 {
                    set_block(blocks, bx, by, bz, SAND);
                    if hash2d(bx * 3, bz * 5) < 0.5 && by + 1 < WORLD_SIZE_Y as i32 {
                        set_block(blocks, bx, by + 1, bz, SAND);
                    }
                }
            }
        }
    }

    // Interior dividing walls
    for y in 0..3 {
        for z in 3..(d - 3) {
            let bx = ox + 10;
            let bz = oz + z;
            let by = base_y + 2 + y;
            if bx < WORLD_SIZE_X as i32 && bz < WORLD_SIZE_Z as i32 && by < WORLD_SIZE_Y as i32 {
                if z != 9 && z != 10 {
                    set_block(blocks, bx, by, bz, CONCRETE);
                }
            }
        }
    }
}

// ── Rubble piles ──

fn build_rubble_piles(blocks: &mut [u8]) {
    let piles: [(i32, i32); 19] = [
        (12, 35), (38, 15), (72, 45), (55, 70), (95, 25),
        (25, 80), (80, 60), (45, 105), (110, 45), (65, 15),
        (32, 60), (90, 100), (50, 50), (15, 115), (105, 95),
        (42, 42), (78, 78), (60, 95), (20, 50),
    ];

    for (cx, cz) in piles {
        if cx >= WORLD_SIZE_X as i32 || cz >= WORLD_SIZE_Z as i32 { continue; }
        let radius = 2 + (hash2d(cx, cz) * 3.0).floor() as i32;
        let pile_height = 2 + (hash2d(cx * 3, cz * 7) * 3.0).floor() as i32;

        for dx in -radius..=radius {
            for dz in -radius..=radius {
                let dist = ((dx * dx + dz * dz) as f64).sqrt();
                if dist > radius as f64 { continue; }
                let x = cx + dx;
                let z = cz + dz;
                if x < 0 || x >= WORLD_SIZE_X as i32 || z < 0 || z >= WORLD_SIZE_Z as i32 { continue; }

                let py = (pile_height as f64 * (1.0 - dist / radius as f64)).floor() as i32;
                let base_h = height_at(x, z);

                for y in 1..=py {
                    let by = base_h + y;
                    if by >= WORLD_SIZE_Y as i32 { break; }
                    let r = hash2d(x * 11 + y, z * 17);
                    let bt = if r < 0.4 {
                        RUBBLE
                    } else if r < 0.6 {
                        CONCRETE
                    } else if r < 0.75 {
                        REBAR
                    } else if r < 0.9 {
                        BRICK
                    } else {
                        DARK_CONCRETE
                    };
                    set_block(blocks, x, by, z, bt);
                }
            }
        }
    }
}

// ── Barricades ──

fn build_barricades(blocks: &mut [u8]) {
    // (x, z, length, height, is_ns)
    let barricades: [(i32, i32, i32, i32, bool); 12] = [
        (30, 35, 5, 2, false),
        (75, 55, 4, 3, true),
        (50, 25, 6, 2, false),
        (95, 75, 4, 2, true),
        (20, 90, 5, 3, false),
        (65, 65, 3, 2, true),
        (110, 55, 4, 2, false),
        (40, 75, 5, 2, true),
        (85, 105, 6, 3, false),
        (55, 15, 4, 2, true),
        (100, 30, 3, 2, false),
        (25, 55, 5, 2, true),
    ];

    for (ox, oz, len, h, is_ns) in barricades {
        for i in 0..len {
            let x = if is_ns { ox } else { ox + i };
            let z = if is_ns { oz + i } else { oz };
            if x >= WORLD_SIZE_X as i32 || z >= WORLD_SIZE_Z as i32 { continue; }
            let base_h = height_at(x, z);

            for y in 1..=h {
                let by = base_h + y;
                if by >= WORLD_SIZE_Y as i32 { break; }
                let is_sandbag = hash2d(x * 5 + y, z * 9) > 0.4;
                set_block(blocks, x, by, z, if is_sandbag { SAND } else { CONCRETE });
            }
        }
    }
}

// ── Vehicle husks ──

fn build_vehicles(blocks: &mut [u8]) {
    // (x, z, w, h, d, flipped)
    let vehicles: [(i32, i32, i32, i32, i32, bool); 8] = [
        (42, 40, 4, 2, 2, false),
        (63, 42, 4, 2, 2, false),
        (88, 62, 6, 3, 3, false),
        (39, 88, 4, 2, 2, true),
        (86, 90, 4, 2, 2, false),
        (66, 88, 6, 3, 3, false),
        (40, 63, 4, 2, 2, false),
        (110, 65, 4, 2, 2, true),
    ];

    for (ox, oz, vw, vh, vd, flipped) in vehicles {
        let base_h = height_at(ox, oz);

        if flipped {
            for x in 0..vw {
                for y in 0..vd {
                    for z in 0..vh {
                        let bx = ox + x;
                        let bz = oz + z;
                        let by = base_h + 1 + y;
                        if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 || by >= WORLD_SIZE_Y as i32 { continue; }
                        let is_shell = x == 0 || x == vw - 1 || y == 0 || y == vd - 1 || z == 0 || z == vh - 1;
                        if is_shell {
                            set_block(blocks, bx, by, bz, METAL);
                        }
                    }
                }
            }
        } else {
            for x in 0..vw {
                for y in 0..vh {
                    for z in 0..vd {
                        let bx = ox + x;
                        let bz = oz + z;
                        let by = base_h + 1 + y;
                        if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 || by >= WORLD_SIZE_Y as i32 { continue; }
                        let is_shell = x == 0 || x == vw - 1 || y == 0 || y == vh - 1 || z == 0 || z == vd - 1;
                        if is_shell {
                            set_block(blocks, bx, by, bz, METAL);
                        }
                    }
                }
            }
        }
    }
}

// ── RLE Compression ──

pub fn rle_encode(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let val = data[i];
        let mut run: u8 = 1;
        while (i + run as usize) < data.len() && data[i + run as usize] == val && run < 255 {
            run += 1;
        }
        result.push(val);
        result.push(run);
        i += run as usize;
    }
    result
}

pub fn rle_decode(data: &[u8], output: &mut [u8]) {
    let mut out_idx = 0;
    let mut i = 0;
    while i + 1 < data.len() && out_idx < output.len() {
        let val = data[i];
        let run = data[i + 1] as usize;
        for _ in 0..run {
            if out_idx >= output.len() { break; }
            output[out_idx] = val;
            out_idx += 1;
        }
        i += 2;
    }
}

// ── Structural Integrity (Bounded BFS) ──

use std::collections::HashSet;

const MAX_BFS_NODES: usize = 200;
const MAX_BFS_RADIUS: i32 = 12;

const N6: [(i32, i32, i32); 6] = [
    (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
];

fn pack_coord(x: i32, y: i32, z: i32) -> u32 {
    ((x as u32) & 0xFF) | (((y as u32) & 0xFF) << 8) | (((z as u32) & 0xFF) << 16)
}

struct BfsResult {
    blocks: Vec<(i32, i32, i32, u8)>,
    visited: Vec<u32>,
    is_supported: bool,
}

fn bounded_bfs(
    blocks: &[u8],
    start_x: i32, start_y: i32, start_z: i32,
    global_visited: &HashSet<u32>,
) -> BfsResult {
    let mut queue = vec![(start_x, start_y, start_z)];
    let mut visited = Vec::new();
    let mut result_blocks = Vec::new();
    let mut local_visited = HashSet::new();
    let mut is_supported = false;
    let mut q_head = 0;

    let start_key = pack_coord(start_x, start_y, start_z);
    local_visited.insert(start_key);
    visited.push(start_key);

    let r2 = MAX_BFS_RADIUS * MAX_BFS_RADIUS;

    while q_head < queue.len() && result_blocks.len() < MAX_BFS_NODES {
        let (x, y, z) = queue[q_head];
        q_head += 1;

        // Distance check from start
        let dx = x - start_x;
        let dy = y - start_y;
        let dz = z - start_z;
        if dx * dx + dy * dy + dz * dz > r2 {
            continue;
        }

        let bt = get_block(blocks, x, y, z);
        if bt == AIR {
            continue;
        }

        result_blocks.push((x, y, z, bt));

        // Ground support: y=0 is always supported
        if y == 0 {
            is_supported = true;
            break;
        }

        // Support from below: solid block below that isn't part of this component
        let below_key = pack_coord(x, y - 1, z);
        let below_bt = get_block(blocks, x, y - 1, z);
        if below_bt != AIR && !local_visited.contains(&below_key) && !global_visited.contains(&below_key) {
            is_supported = true;
            break;
        }

        // Expand to 6 neighbors
        for &(ox, oy, oz) in &N6 {
            let nx = x + ox;
            let ny = y + oy;
            let nz = z + oz;
            if !in_bounds(nx, ny, nz) {
                continue;
            }

            let nkey = pack_coord(nx, ny, nz);
            if local_visited.contains(&nkey) || global_visited.contains(&nkey) {
                continue;
            }
            if get_block(blocks, nx, ny, nz) == AIR {
                continue;
            }

            local_visited.insert(nkey);
            visited.push(nkey);
            queue.push((nx, ny, nz));
        }
    }

    BfsResult {
        blocks: result_blocks,
        visited,
        is_supported,
    }
}

/// Check structural integrity after block destruction.
/// Takes the full flat world array and positions of destroyed blocks.
/// Returns blocks that lost support and should fall: (x, y, z, block_type).
pub fn check_structural_integrity(
    blocks: &[u8],
    destroyed_positions: &[(i32, i32, i32)],
) -> Vec<(i32, i32, i32, u8)> {
    let mut fallen = Vec::new();
    let mut global_visited = HashSet::new();

    for &(px, py, pz) in destroyed_positions {
        for &(dx, dy, dz) in &N6 {
            let nx = px + dx;
            let ny = py + dy;
            let nz = pz + dz;

            if !in_bounds(nx, ny, nz) {
                continue;
            }
            let bt = get_block(blocks, nx, ny, nz);
            if bt == AIR {
                continue;
            }

            let key = pack_coord(nx, ny, nz);
            if global_visited.contains(&key) {
                continue;
            }

            let result = bounded_bfs(blocks, nx, ny, nz, &global_visited);
            for &k in &result.visited {
                global_visited.insert(k);
            }

            if !result.is_supported {
                for &block in &result.blocks {
                    fallen.push(block);
                }
            }
        }
    }

    fallen
}

/// Inject decompressed chunk data into a flat world array.
pub fn inject_chunk(blocks: &mut [u8], cx: usize, cy: usize, cz: usize, chunk_data: &[u8]) {
    for lz in 0..CHUNK_SIZE {
        for ly in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let gx = cx * CHUNK_SIZE + lx;
                let gy = cy * CHUNK_SIZE + ly;
                let gz = cz * CHUNK_SIZE + lz;
                let global_idx = gx + gy * WORLD_SIZE_X + gz * WORLD_SIZE_X * WORLD_SIZE_Y;
                let local_idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                blocks[global_idx] = chunk_data[local_idx];
            }
        }
    }
}

// ── Chunk extraction ──

pub fn pack_chunk_id(cx: u8, cy: u8, cz: u8) -> u32 {
    cx as u32 | ((cy as u32) << 8) | ((cz as u32) << 16)
}

pub fn unpack_chunk_id(id: u32) -> (u8, u8, u8) {
    ((id & 0xFF) as u8, ((id >> 8) & 0xFF) as u8, ((id >> 16) & 0xFF) as u8)
}

/// Extract a 16x16x16 chunk from the flat world array and RLE-compress it.
pub fn extract_chunk(blocks: &[u8], cx: usize, cy: usize, cz: usize) -> Vec<u8> {
    let mut chunk_data = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];

    for lz in 0..CHUNK_SIZE {
        for ly in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let gx = cx * CHUNK_SIZE + lx;
                let gy = cy * CHUNK_SIZE + ly;
                let gz = cz * CHUNK_SIZE + lz;
                let global_idx = gx + gy * WORLD_SIZE_X + gz * WORLD_SIZE_X * WORLD_SIZE_Y;
                let local_idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                chunk_data[local_idx] = blocks[global_idx];
            }
        }
    }

    rle_encode(&chunk_data)
}
