// ── World Generation ──
// Procedural biome-based world generation for a 250x48x250 world.
// Chunks are generated lazily (on-demand) using a deterministic seed.

pub const WORLD_SIZE_X: usize = 250;
pub const WORLD_SIZE_Y: usize = 48;
pub const WORLD_SIZE_Z: usize = 250;
pub const CHUNK_SIZE: usize = 16;
pub const NUM_CHUNKS_X: usize = (WORLD_SIZE_X + CHUNK_SIZE - 1) / CHUNK_SIZE;
pub const NUM_CHUNKS_Y: usize = (WORLD_SIZE_Y + CHUNK_SIZE - 1) / CHUNK_SIZE;
pub const NUM_CHUNKS_Z: usize = (WORLD_SIZE_Z + CHUNK_SIZE - 1) / CHUNK_SIZE;

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
pub const GRASS: u8 = 10;
pub const WOOD: u8 = 11;
pub const STONE: u8 = 12;
pub const SNOW: u8 = 13;
pub const LANTERN: u8 = 14;

// ── Biome System ──

#[derive(Clone, Copy, PartialEq)]
pub enum Biome {
    Desert,
    Forest,
    Urban,
    Mountains,
    Plains,
}

// ── Seeded Noise Helpers ──

fn hash2d_seeded(x: i32, z: i32, seed: u64) -> f64 {
    let sx = x.wrapping_add(seed as i32);
    let sz = z.wrapping_add((seed >> 32) as i32);
    let mut h: i32 = sx
        .wrapping_mul(374761393)
        .wrapping_add(sz.wrapping_mul(668265263));
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    ((h ^ (h >> 16)) & 0x7fffffff) as f64 / 0x7fffffff as f64
}

fn sm(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn lrp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn vnoise_seeded(x: f64, z: f64, seed: u64) -> f64 {
    let ix = x.floor() as i32;
    let iz = z.floor() as i32;
    let fx = sm(x - ix as f64);
    let fz = sm(z - iz as f64);
    lrp(
        lrp(
            hash2d_seeded(ix, iz, seed),
            hash2d_seeded(ix + 1, iz, seed),
            fx,
        ),
        lrp(
            hash2d_seeded(ix, iz + 1, seed),
            hash2d_seeded(ix + 1, iz + 1, seed),
            fx,
        ),
        fz,
    )
}

fn fbm_seeded(mut x: f64, mut z: f64, oct: usize, seed: u64) -> f64 {
    let mut v = 0.0;
    let mut a = 1.0;
    let mut m = 0.0;
    for i in 0..oct {
        v += vnoise_seeded(x, z, seed.wrapping_add(i as u64 * 7919)) * a;
        m += a;
        a *= 0.5;
        x *= 2.0;
        z *= 2.0;
    }
    v / m
}

// ── Biome Selection ──

fn get_biome(wx: i32, wz: i32, seed: u64) -> Biome {
    // Voronoi-like cells: find the closest cell center and use its hash to pick biome
    let cell_size = 90.0;
    let cx = (wx as f64 / cell_size).floor() as i32;
    let cz = (wz as f64 / cell_size).floor() as i32;

    let mut best_dist = f64::MAX;
    let mut best_biome = Biome::Plains;

    for dci in -1..=1 {
        for dcj in -1..=1 {
            let ci = cx + dci;
            let cj = cz + dcj;
            // Cell center with jitter
            let jx = hash2d_seeded(ci * 31, cj * 17, seed.wrapping_add(100));
            let jz = hash2d_seeded(ci * 53, cj * 41, seed.wrapping_add(200));
            let center_x = (ci as f64 + 0.3 + jx * 0.4) * cell_size;
            let center_z = (cj as f64 + 0.3 + jz * 0.4) * cell_size;

            let dx = wx as f64 - center_x;
            let dz = wz as f64 - center_z;
            let dist = dx * dx + dz * dz;

            if dist < best_dist {
                best_dist = dist;
                let biome_hash = hash2d_seeded(ci * 97, cj * 89, seed.wrapping_add(300));
                best_biome = match (biome_hash * 5.0) as u32 {
                    0 => Biome::Desert,
                    1 => Biome::Forest,
                    2 => Biome::Urban,
                    3 => Biome::Mountains,
                    _ => Biome::Plains,
                };
            }
        }
    }

    // Force center area (spawn) to be Urban for gameplay
    let center = WORLD_SIZE_X as f64 / 2.0;
    let dx = wx as f64 - center;
    let dz = wz as f64 - center;
    if dx * dx + dz * dz < 44.0 * 44.0 {
        return Biome::Urban;
    }

    best_biome
}

// ── Per-Biome Height ──

fn biome_height(biome: Biome, wx: i32, wz: i32, seed: u64) -> i32 {
    let nx = wx as f64 / 96.0;
    let nz = wz as f64 / 96.0;

    let h = match biome {
        Biome::Desert => {
            // Gentle dunes
            let base = 4.0 + fbm_seeded(nx * 2.4, nz * 2.4, 4, seed.wrapping_add(10)) * 4.6;
            base.max(3.0).min(9.0)
        }
        Biome::Forest => {
            // Rolling hills
            let base = 4.0 + fbm_seeded(nx * 3.4, nz * 3.4, 4, seed.wrapping_add(20)) * 6.6;
            base.max(4.0).min(12.0)
        }
        Biome::Urban => {
            // Flat with minor variation
            let base = 4.5 + fbm_seeded(nx * 4.8, nz * 4.8, 3, seed.wrapping_add(30)) * 1.7;
            // Flatten spawn area
            let center = WORLD_SIZE_X as f64 / 2.0;
            let dx = wx as f64 - center;
            let dz = wz as f64 - center;
            let cd = (dx * dx + dz * dz).sqrt();
            if cd < 28.0 {
                lrp(5.0, base, sm(cd / 28.0))
            } else {
                base
            }
            .max(4.0)
            .min(8.0)
        }
        Biome::Mountains => {
            // High peaks
            let base = 6.0 + fbm_seeded(nx * 2.8, nz * 2.8, 5, seed.wrapping_add(40)) * 20.0;
            base.max(5.0).min(25.0)
        }
        Biome::Plains => {
            // Very flat
            let base = 3.0 + fbm_seeded(nx * 3.4, nz * 3.4, 3, seed.wrapping_add(50)) * 3.8;
            base.max(3.0).min(6.0)
        }
    };

    h.floor() as i32
}

fn biome_surface_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => GRASS,
        Biome::Urban => ASPHALT,
        Biome::Mountains => STONE,
        Biome::Plains => GRASS,
    }
}

fn biome_subsurface_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => DIRT,
        Biome::Urban => CONCRETE,
        Biome::Mountains => DARK_CONCRETE,
        Biome::Plains => DIRT,
    }
}

fn biome_deep_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => DIRT,
        Biome::Urban => DARK_CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => DIRT,
    }
}

// ── Structure Generation ──

fn in_spawn_safe_zone(wx: i32, wz: i32) -> bool {
    let center = WORLD_SIZE_X as i32 / 2;
    let dx = wx - center;
    let dz = wz - center;
    dx * dx + dz * dz < 28 * 28
}

// Place a structure into a chunk-local block array
fn place_structure_in_chunk(
    chunk_blocks: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    struct_ox: i32,
    struct_oz: i32,
    struct_type: u8,
    sw: i32,
    sd: i32,
    biome: Biome,
    seed: u64,
) {
    let base_h = biome_height(biome, struct_ox + sw / 2, struct_oz + sd / 2, seed);

    match struct_type {
        0 => place_ruined_building(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            sw,
            sd,
            base_h,
            biome,
            seed,
        ),
        1 => place_tower(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            base_h,
            biome,
            seed,
        ),
        2 => place_bunker(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            sw,
            sd,
            base_h,
            biome,
            seed,
        ),
        3 => place_barricade_line(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            sw,
            base_h,
            biome,
            seed,
        ),
        4 => place_rubble_pile(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            sw,
            base_h,
            seed,
        ),
        5 => place_city_block(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            sw,
            sd,
            base_h,
            seed,
        ),
        _ => place_megatower(
            chunk_blocks,
            chunk_wx,
            chunk_wy,
            chunk_wz,
            struct_ox,
            struct_oz,
            sw,
            sd,
            base_h,
            biome,
            seed,
        ),
    }
}

fn set_chunk_block(
    chunk_blocks: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    wx: i32,
    wy: i32,
    wz: i32,
    bt: u8,
) {
    let lx = wx - cx;
    let ly = wy - cy;
    let lz = wz - cz;
    if lx >= 0
        && lx < CHUNK_SIZE as i32
        && ly >= 0
        && ly < CHUNK_SIZE as i32
        && lz >= 0
        && lz < CHUNK_SIZE as i32
    {
        let idx = lx as usize + ly as usize * CHUNK_SIZE + lz as usize * CHUNK_SIZE * CHUNK_SIZE;
        if chunk_blocks[idx] == AIR || bt != AIR {
            chunk_blocks[idx] = bt;
        }
    }
}

fn set_chunk_block_if_air(
    chunk_blocks: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    wx: i32,
    wy: i32,
    wz: i32,
    bt: u8,
) {
    let lx = wx - cx;
    let ly = wy - cy;
    let lz = wz - cz;
    if lx >= 0
        && lx < CHUNK_SIZE as i32
        && ly >= 0
        && ly < CHUNK_SIZE as i32
        && lz >= 0
        && lz < CHUNK_SIZE as i32
    {
        let idx = lx as usize + ly as usize * CHUNK_SIZE + lz as usize * CHUNK_SIZE * CHUNK_SIZE;
        if chunk_blocks[idx] == AIR {
            chunk_blocks[idx] = bt;
        }
    }
}

fn biome_wall_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => WOOD,
        Biome::Urban => CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => BRICK,
    }
}

fn biome_floor_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => WOOD,
        Biome::Urban => DARK_CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => DIRT,
    }
}

fn place_ruined_building(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let floors = 2 + (hash2d_seeded(ox * 11, oz * 13, seed.wrapping_add(900)) * 3.0) as i32;
    let story_h = 4;
    let total_h = floors * story_h;
    let wall_bt = biome_wall_block(biome);
    let floor_bt = biome_floor_block(biome);

    for x in 0..w {
        for z in 0..d {
            for y in 0..total_h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;

                if bx < 0
                    || bx >= WORLD_SIZE_X as i32
                    || bz < 0
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_floor = y > 0 && y % story_h == 0;
                let is_door = (x == w / 2 || x == w / 2 + 1) && z == 0 && y < 3;

                let destruction =
                    hash2d_seeded(bx * 17 + by, bz * 31 + by, seed.wrapping_add(1000));

                if is_door {
                    continue;
                }

                if is_floor && !is_wall {
                    if destruction > 0.25 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, floor_bt);
                    }
                } else if is_wall {
                    let dmg_threshold = if y > story_h * 2 {
                        0.30
                    } else if y > story_h {
                        0.18
                    } else {
                        0.08
                    };
                    if destruction > dmg_threshold {
                        let bt = if destruction > 0.85 { BRICK } else { wall_bt };
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, bt);
                    } else if y > total_h - 3
                        && hash2d_seeded(bx * 3, bz * 5 + by, seed.wrapping_add(1100)) > 0.5
                    {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, REBAR);
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
            if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if dx >= 0 && dx < w && dz >= 0 && dz < d {
                continue;
            }
            if hash2d_seeded(bx * 19, bz * 23, seed.wrapping_add(1200)) < 0.35 {
                let by = biome_height(biome, bx, bz, seed) + 1;
                if by < WORLD_SIZE_Y as i32 {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, RUBBLE);
                }
            }
        }
    }
}

fn place_tower(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let height = 10 + (hash2d_seeded(ox * 29, oz * 37, seed.wrapping_add(1300)) * 8.0) as i32;
    let tw = 5;
    let wall_bt = biome_wall_block(biome);

    for y in 0..height {
        for x in 0..tw {
            for z in 0..tw {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == tw - 1 || z == 0 || z == tw - 1;
                if !is_wall {
                    continue;
                }

                if y > height - 4 {
                    let keep = hash2d_seeded(bx * 13 + y, bz * 7 + y, seed.wrapping_add(1400));
                    if keep < 0.4 {
                        continue;
                    }
                    let bt = if keep > 0.8 { REBAR } else { wall_bt };
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, bt);
                } else {
                    let collapse = if x == 0 && y > height / 2 { 0.35 } else { 0.05 };
                    if hash2d_seeded(bx * 11 + y, bz * 17, seed.wrapping_add(1500)) > collapse {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                    }
                }
            }
        }
    }

    // Platforms
    for x in 0..tw {
        for z in 0..tw {
            let bx = ox + x;
            let bz = oz + z;
            if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            set_chunk_block(cb, cx, cy, cz, bx, base_y + 1, bz, biome_floor_block(biome));
            let mid_y = base_y + 1 + height / 2;
            if mid_y < WORLD_SIZE_Y as i32 {
                set_chunk_block(cb, cx, cy, cz, bx, mid_y, bz, biome_floor_block(biome));
            }
        }
    }

    let tower_top = base_y + height;
    place_rooftop_lantern(cb, cx, cy, cz, ox, tower_top, oz);
    place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, tower_top, oz);
    place_rooftop_lantern(cb, cx, cy, cz, ox, tower_top, oz + tw - 1);
    place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, tower_top, oz + tw - 1);
}

fn place_bunker(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let h = 4;
    let wall_bt = biome_wall_block(biome);

    for y in 0..h {
        for x in 0..w {
            for z in 0..d {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_roof = y == h - 1;
                let is_floor = y == 0;
                let is_door = (x == w / 2 || x == w / 2 + 1) && z == 0 && y < 3;

                if is_door {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, biome_floor_block(biome));
                } else if is_roof && x > 0 && x < w - 1 && z > 0 && z < d - 1 {
                    let dmg = hash2d_seeded(bx * 11, bz * 13, seed.wrapping_add(1600));
                    if dmg > 0.2 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                    }
                } else if is_wall {
                    // Window slits
                    let is_slit = y == 2 && (x % 3 == 0 || z % 3 == 0);
                    if !is_slit {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                    }
                }
            }
        }
    }
}

fn place_barricade_line(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    len: i32,
    _base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let h = 2 + (hash2d_seeded(ox * 47, oz * 53, seed.wrapping_add(1700)) * 2.0) as i32;
    let is_ns = hash2d_seeded(ox * 61, oz * 67, seed.wrapping_add(1800)) > 0.5;
    let wall_bt = biome_wall_block(biome);

    for i in 0..len {
        let x = if is_ns { ox } else { ox + i };
        let z = if is_ns { oz + i } else { oz };
        if x >= WORLD_SIZE_X as i32 || z >= WORLD_SIZE_Z as i32 {
            continue;
        }
        let local_base = biome_height(biome, x, z, seed);

        for y in 1..=h {
            let by = local_base + y;
            if by >= WORLD_SIZE_Y as i32 {
                break;
            }
            let bt = if hash2d_seeded(x * 5 + y, z * 9, seed.wrapping_add(1900)) > 0.4 {
                SAND
            } else {
                wall_bt
            };
            set_chunk_block(cb, cx, cy, cz, x, by, z, bt);
        }
    }
}

fn place_rubble_pile(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    radius: i32,
    base_y: i32,
    seed: u64,
) {
    let pile_h = 2 + (hash2d_seeded(ox * 3, oz * 7, seed.wrapping_add(2000)) * 4.0) as i32;
    let r = radius.min(6);

    for dx in -r..=r {
        for dz in -r..=r {
            let dist = ((dx * dx + dz * dz) as f64).sqrt();
            if dist > r as f64 {
                continue;
            }
            let x = ox + dx;
            let z = oz + dz;
            if x < 0 || x >= WORLD_SIZE_X as i32 || z < 0 || z >= WORLD_SIZE_Z as i32 {
                continue;
            }

            let py = (pile_h as f64 * (1.0 - dist / r as f64)).floor() as i32;
            for y in 1..=py {
                let by = base_y + y;
                if by >= WORLD_SIZE_Y as i32 {
                    break;
                }
                let r_val = hash2d_seeded(x * 11 + y, z * 17, seed.wrapping_add(2100));
                let bt = if r_val < 0.4 {
                    RUBBLE
                } else if r_val < 0.6 {
                    CONCRETE
                } else if r_val < 0.75 {
                    REBAR
                } else if r_val < 0.9 {
                    BRICK
                } else {
                    DARK_CONCRETE
                };
                set_chunk_block(cb, cx, cy, cz, x, by, z, bt);
            }
        }
    }
}

fn scatter_vegetation(
    chunk_blocks: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    wx: i32,
    wz: i32,
    base_h: i32,
    biome: Biome,
    seed: u64,
) {
    if base_h < 1 || base_h >= WORLD_SIZE_Y as i32 - 8 {
        return;
    }
    if in_spawn_safe_zone(wx, wz) {
        return;
    }
    if is_road(wx, wz, seed).is_some() {
        return;
    }

    let flora_roll = hash2d_seeded(wx * 71, wz * 97, seed.wrapping_add(4200));
    match biome {
        Biome::Forest => {
            if flora_roll > 0.58 {
                let trunk_h =
                    3 + (hash2d_seeded(wx * 17, wz * 23, seed.wrapping_add(4201)) * 3.0) as i32;
                for y in 1..=trunk_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        WOOD,
                    );
                }

                let canopy_y = base_h + trunk_h;
                for dx in -2..=2 {
                    for dz in -2..=2 {
                        if dx * dx + dz * dz > 5 {
                            continue;
                        }
                        let bx = wx + dx;
                        let bz = wz + dz;
                        if bx < 0
                            || bx >= WORLD_SIZE_X as i32
                            || bz < 0
                            || bz >= WORLD_SIZE_Z as i32
                        {
                            continue;
                        }
                        if canopy_y < WORLD_SIZE_Y as i32 {
                            set_chunk_block_if_air(
                                chunk_blocks,
                                chunk_wx,
                                chunk_wy,
                                chunk_wz,
                                bx,
                                canopy_y,
                                bz,
                                GRASS,
                            );
                        }
                        if canopy_y + 1 < WORLD_SIZE_Y as i32
                            && hash2d_seeded(bx * 3, bz * 7, seed.wrapping_add(4202)) > 0.35
                        {
                            set_chunk_block_if_air(
                                chunk_blocks,
                                chunk_wx,
                                chunk_wy,
                                chunk_wz,
                                bx,
                                canopy_y + 1,
                                bz,
                                GRASS,
                            );
                        }
                    }
                }
            } else if flora_roll > 0.46 {
                let bush_h =
                    1 + (hash2d_seeded(wx * 5, wz * 11, seed.wrapping_add(4203)) * 2.0) as i32;
                for y in 1..=bush_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        GRASS,
                    );
                }
            }
        }
        Biome::Plains => {
            if flora_roll > 0.75 {
                let stem_h =
                    2 + (hash2d_seeded(wx * 13, wz * 9, seed.wrapping_add(4204)) * 2.0) as i32;
                for y in 1..=stem_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        WOOD,
                    );
                }
                if base_h + stem_h + 1 < WORLD_SIZE_Y as i32 {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + stem_h + 1,
                        wz,
                        GRASS,
                    );
                }
            } else if flora_roll > 0.58 {
                set_chunk_block_if_air(
                    chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    wx,
                    base_h + 1,
                    wz,
                    GRASS,
                );
            }
        }
        Biome::Desert => {
            if flora_roll > 0.92 {
                let cactus_h =
                    2 + (hash2d_seeded(wx * 19, wz * 7, seed.wrapping_add(4205)) * 3.0) as i32;
                for y in 1..=cactus_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        WOOD,
                    );
                }
            }
        }
        Biome::Mountains => {
            if flora_roll > 0.88 {
                set_chunk_block_if_air(
                    chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    wx,
                    base_h + 1,
                    wz,
                    STONE,
                );
            }
        }
        Biome::Urban => {}
    }
}

fn fill_urban_base(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    x0: i32,
    z0: i32,
    w: i32,
    d: i32,
    base_y: i32,
    bt: u8,
) {
    for x in 0..w {
        for z in 0..d {
            for y in base_y - 2..=base_y {
                if y < 0 || y >= WORLD_SIZE_Y as i32 {
                    continue;
                }
                set_chunk_block(cb, cx, cy, cz, x0 + x, y, z0 + z, bt);
            }
        }
    }
}

fn place_city_block(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
    seed: u64,
) {
    if w < 12 || d < 12 {
        return;
    }

    let base_bt = DARK_CONCRETE;
    fill_urban_base(cb, cx, cy, cz, ox, oz, w, d, base_y, base_bt);

    let road_cut = 3;
    for x in 0..w {
        for z in 0..d {
            let is_road = x < road_cut || z < road_cut || x >= w - road_cut || z >= d - road_cut;
            if is_road {
                set_chunk_block(cb, cx, cy, cz, ox + x, base_y + 1, oz + z, ASPHALT);
            }
        }
    }

    let towers = 3 + (hash2d_seeded(ox * 31, oz * 37, seed.wrapping_add(4300)) * 2.0) as i32;
    for i in 0..towers {
        let tx_noise = hash2d_seeded(ox * 59 + i * 13, oz * 61, seed.wrapping_add(4301));
        let tz_noise = hash2d_seeded(ox * 41, oz * 43 + i * 17, seed.wrapping_add(4302));
        let tx = ox + road_cut + 1 + (tx_noise * (w - road_cut * 2 - 6).max(1) as f64) as i32;
        let tz = oz + road_cut + 1 + (tz_noise * (d - road_cut * 2 - 6).max(1) as f64) as i32;
        let tw = 4 + (hash2d_seeded(tx * 7, tz * 11, seed.wrapping_add(4303)) * 4.0) as i32;
        let td = 4 + (hash2d_seeded(tx * 13, tz * 5, seed.wrapping_add(4304)) * 4.0) as i32;
        let th = 10 + (hash2d_seeded(tx * 17, tz * 19, seed.wrapping_add(4305)) * 16.0) as i32;

        for x in 0..tw {
            for z in 0..td {
                for y in 0..th {
                    let bx = tx + x;
                    let bz = tz + z;
                    let by = base_y + 2 + y;
                    if bx < 0
                        || bx >= WORLD_SIZE_X as i32
                        || bz < 0
                        || bz >= WORLD_SIZE_Z as i32
                        || by < 0
                        || by >= WORLD_SIZE_Y as i32
                    {
                        continue;
                    }

                    let edge = x == 0 || x == tw - 1 || z == 0 || z == td - 1;
                    let floor = y % 4 == 0;
                    if edge {
                        let window = y > 1
                            && !floor
                            && ((x + z + y + i) % 3 != 0)
                            && hash2d_seeded(bx * 3 + by, bz * 5 + by, seed.wrapping_add(4306))
                                > 0.22;
                        if !window {
                            let wall_bt = if y > th - 4 { BRICK } else { CONCRETE };
                            set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                        }
                    } else if floor {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, DARK_CONCRETE);
                    }
                }
            }
        }

        let roof_y = base_y + 1 + th;
        place_rooftop_lantern(cb, cx, cy, cz, tx, roof_y, tz);
        place_rooftop_lantern(cb, cx, cy, cz, tx + tw - 1, roof_y, tz);
        place_rooftop_lantern(cb, cx, cy, cz, tx, roof_y, tz + td - 1);
        place_rooftop_lantern(cb, cx, cy, cz, tx + tw - 1, roof_y, tz + td - 1);

        for x in -1..=tw {
            for z in -1..=td {
                let bx = tx + x;
                let bz = tz + z;
                if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 {
                    continue;
                }
                if hash2d_seeded(bx * 29, bz * 31, seed.wrapping_add(4307)) > 0.86 {
                    set_chunk_block(cb, cx, cy, cz, bx, base_y + 1, bz, RUBBLE);
                }
            }
        }
    }
}

fn place_megatower(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let tw = w.max(12).min(22);
    let td = d.max(12).min(22);
    let tower_h = 22 + (hash2d_seeded(ox * 73, oz * 79, seed.wrapping_add(4400)) * 20.0) as i32;

    let wall_bt = if biome == Biome::Urban {
        METAL
    } else {
        biome_wall_block(biome)
    };
    let floor_bt = if biome == Biome::Urban {
        DARK_CONCRETE
    } else {
        biome_floor_block(biome)
    };

    fill_urban_base(
        cb,
        cx,
        cy,
        cz,
        ox - 2,
        oz - 2,
        tw + 4,
        td + 4,
        base_y,
        DARK_CONCRETE,
    );

    for x in 0..tw {
        for z in 0..td {
            for y in 0..tower_h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 2 + y;
                if bx < 0
                    || bx >= WORLD_SIZE_X as i32
                    || bz < 0
                    || bz >= WORLD_SIZE_Z as i32
                    || by < 0
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let edge = x == 0 || x == tw - 1 || z == 0 || z == td - 1;
                let floor = y % 5 == 0;
                let lobby = y < 4;

                if edge {
                    let is_window = y > 2
                        && !floor
                        && !lobby
                        && ((x + z + y) % 3 != 0)
                        && hash2d_seeded(bx * 7 + by, bz * 11 + by, seed.wrapping_add(4401)) > 0.18;
                    if !is_window {
                        let bt = if y > tower_h - 5 { BRICK } else { wall_bt };
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, bt);
                    }
                } else if floor || lobby {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, floor_bt);
                }
            }
        }
    }

    let roof_y = base_y + 1 + tower_h;
    if roof_y < WORLD_SIZE_Y as i32 {
        for x in 0..tw {
            for z in 0..td {
                let bx = ox + x;
                let bz = oz + z;
                set_chunk_block(cb, cx, cy, cz, bx, roof_y, bz, METAL);
            }
        }

        place_rooftop_lantern(cb, cx, cy, cz, ox, roof_y, oz);
        place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, roof_y, oz);
        place_rooftop_lantern(cb, cx, cy, cz, ox, roof_y, oz + td - 1);
        place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, roof_y, oz + td - 1);

        let antenna_h = 2 + (hash2d_seeded(ox * 83, oz * 89, seed.wrapping_add(4402)) * 4.0) as i32;
        let ax = ox + tw / 2;
        let az = oz + td / 2;
        for ay in 1..=antenna_h {
            let by = roof_y + ay;
            if by >= WORLD_SIZE_Y as i32 {
                break;
            }
            set_chunk_block(cb, cx, cy, cz, ax, by, az, REBAR);
        }
        place_rooftop_lantern(cb, cx, cy, cz, ax, roof_y + antenna_h, az);
    }

    for x in -2..=(tw + 1) {
        for z in -2..=(td + 1) {
            let bx = ox + x;
            let bz = oz + z;
            if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if hash2d_seeded(bx * 97, bz * 101, seed.wrapping_add(4403)) > 0.9 {
                set_chunk_block(cb, cx, cy, cz, bx, base_y + 1, bz, RUBBLE);
            }
        }
    }
}

// ── Road Generation ──

fn is_road(wx: i32, wz: i32, _seed: u64) -> Option<u8> {
    // Roads every ~48 blocks, 5 blocks wide
    let road_spacing = 48;
    let road_half = 2;

    // N-S roads
    let nx = ((wx + road_spacing / 2) % road_spacing + road_spacing) % road_spacing;
    if nx <= road_half * 2 {
        let center_offset = nx - road_half;
        return if center_offset == 0 && (wz % 10) < 5 {
            Some(SAND) // Center line marking
        } else {
            Some(ASPHALT)
        };
    }

    // E-W roads
    let nz = ((wz + road_spacing / 2) % road_spacing + road_spacing) % road_spacing;
    if nz <= road_half * 2 {
        let center_offset = nz - road_half;
        return if center_offset == 0 && (wx % 10) < 5 {
            Some(SAND)
        } else {
            Some(ASPHALT)
        };
    }

    None
}

fn mod_wrap(v: i32, modulus: i32) -> i32 {
    ((v % modulus) + modulus) % modulus
}

fn mod_wrap_dist(v: i32, modulus: i32, center: i32) -> i32 {
    let m = mod_wrap(v, modulus);
    let d = (m - center).abs();
    d.min(modulus - d)
}

fn should_place_road_lantern(wx: i32, wz: i32, biome: Biome, seed: u64) -> bool {
    if in_spawn_safe_zone(wx, wz) {
        return false;
    }
    if biome != Biome::Urban {
        return false;
    }

    const ROAD_SPACING: i32 = 48;
    const ROAD_CENTER: i32 = 26;
    const SIDEWALK_DIST: i32 = 3;

    let dist_ns = mod_wrap_dist(wx, ROAD_SPACING, ROAD_CENTER);
    let dist_ew = mod_wrap_dist(wz, ROAD_SPACING, ROAD_CENTER);
    let near_ns = dist_ns == SIDEWALK_DIST;
    let near_ew = dist_ew == SIDEWALK_DIST;
    if !near_ns && !near_ew {
        return false;
    }

    let axis_gate = if near_ns && !near_ew {
        mod_wrap(wz, 28) == 0
    } else if near_ew && !near_ns {
        mod_wrap(wx, 28) == 0
    } else {
        mod_wrap(wx + wz, 42) == 0
    };

    if !axis_gate {
        return false;
    }

    hash2d_seeded(
        wx * 151 + wz * 17,
        wz * 163 + wx * 13,
        seed.wrapping_add(4600),
    ) > 0.86
}

fn place_lantern_post(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    wx: i32,
    base_y: i32,
    wz: i32,
) {
    if base_y < 0 || base_y + 4 >= WORLD_SIZE_Y as i32 {
        return;
    }

    set_chunk_block_if_air(cb, cx, cy, cz, wx, base_y + 1, wz, REBAR);
    set_chunk_block_if_air(cb, cx, cy, cz, wx, base_y + 2, wz, REBAR);
    set_chunk_block_if_air(cb, cx, cy, cz, wx, base_y + 3, wz, LANTERN);
}

fn place_rooftop_lantern(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    wx: i32,
    roof_y: i32,
    wz: i32,
) {
    if roof_y < 0 || roof_y + 2 >= WORLD_SIZE_Y as i32 {
        return;
    }

    set_chunk_block_if_air(cb, cx, cy, cz, wx, roof_y + 1, wz, METAL);
    set_chunk_block_if_air(cb, cx, cy, cz, wx, roof_y + 2, wz, LANTERN);
}

// ── Core Chunk Generation ──

/// Generate a single 16x16x16 chunk, RLE-compressed.
/// Deterministic given (cx, cy, cz, seed).
pub fn generate_chunk(cx: usize, cy: usize, cz: usize, seed: u64) -> Vec<u8> {
    let mut chunk_blocks = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];

    let chunk_wx = (cx * CHUNK_SIZE) as i32;
    let chunk_wy = (cy * CHUNK_SIZE) as i32;
    let chunk_wz = (cz * CHUNK_SIZE) as i32;

    // Phase 1: Base terrain
    for lx in 0..CHUNK_SIZE {
        for lz in 0..CHUNK_SIZE {
            let wx = chunk_wx + lx as i32;
            let wz = chunk_wz + lz as i32;

            if wx < 0 || wx >= WORLD_SIZE_X as i32 || wz < 0 || wz >= WORLD_SIZE_Z as i32 {
                continue;
            }

            let biome = get_biome(wx, wz, seed);
            let h = biome_height(biome, wx, wz, seed);
            let surface = biome_surface_block(biome);
            let subsurface = biome_subsurface_block(biome);
            let deep = biome_deep_block(biome);

            for ly in 0..CHUNK_SIZE {
                let wy = chunk_wy + ly as i32;
                if wy > h {
                    break;
                }

                let bt = if wy == h {
                    surface
                } else if wy >= h - 2 {
                    subsurface
                } else {
                    deep
                };

                let idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                chunk_blocks[idx] = bt;
            }

            // Phase 2: Roads (Urban biome primarily, but cross all biomes)
            if let Some(road_bt) = is_road(wx, wz, seed) {
                let road_y = h;
                let ly = road_y - chunk_wy;
                if ly >= 0 && ly < CHUNK_SIZE as i32 {
                    let idx = lx + ly as usize * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                    chunk_blocks[idx] = road_bt;
                }
            }

            if should_place_road_lantern(wx, wz, biome, seed) {
                place_lantern_post(&mut chunk_blocks, chunk_wx, chunk_wy, chunk_wz, wx, h, wz);
            }

            // Mountains: snow cap
            if biome == Biome::Mountains && h > 18 {
                let snow_y = h;
                let ly = snow_y - chunk_wy;
                if ly >= 0 && ly < CHUNK_SIZE as i32 {
                    let idx = lx + ly as usize * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                    chunk_blocks[idx] = SNOW;
                }
            }

            // Phase 2b: biome population details (trees, shrubs, debris, cacti)
            scatter_vegetation(
                &mut chunk_blocks,
                chunk_wx,
                chunk_wy,
                chunk_wz,
                wx,
                wz,
                h,
                biome,
                seed,
            );
        }
    }

    // Phase 3a: Urban districts and mega-structures
    let city_grid = 84;
    let city_min_gx = (chunk_wx - city_grid).div_euclid(city_grid) - 1;
    let city_max_gx = (chunk_wx + CHUNK_SIZE as i32 + city_grid).div_euclid(city_grid) + 1;
    let city_min_gz = (chunk_wz - city_grid).div_euclid(city_grid) - 1;
    let city_max_gz = (chunk_wz + CHUNK_SIZE as i32 + city_grid).div_euclid(city_grid) + 1;

    for gx in city_min_gx..=city_max_gx {
        for gz in city_min_gz..=city_max_gz {
            let jitter_x =
                (hash2d_seeded(gx * 17, gz * 29, seed.wrapping_add(5000)) * 18.0) as i32 - 9;
            let jitter_z =
                (hash2d_seeded(gx * 31, gz * 43, seed.wrapping_add(5001)) * 18.0) as i32 - 9;
            let sox = gx * city_grid + city_grid / 2 + jitter_x;
            let soz = gz * city_grid + city_grid / 2 + jitter_z;

            if sox < 0 || sox >= WORLD_SIZE_X as i32 || soz < 0 || soz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if in_spawn_safe_zone(sox, soz) {
                continue;
            }

            let biome = get_biome(sox, soz, seed);
            let district_roll = hash2d_seeded(gx * 107, gz * 113, seed.wrapping_add(5002));

            if biome == Biome::Urban && district_roll > 0.20 {
                let district_w =
                    30 + (hash2d_seeded(gx * 19, gz * 23, seed.wrapping_add(5003)) * 22.0) as i32;
                let district_d =
                    30 + (hash2d_seeded(gx * 41, gz * 47, seed.wrapping_add(5004)) * 22.0) as i32;
                let ox = (sox - district_w / 2).clamp(1, WORLD_SIZE_X as i32 - district_w - 1);
                let oz = (soz - district_d / 2).clamp(1, WORLD_SIZE_Z as i32 - district_d - 1);

                place_structure_in_chunk(
                    &mut chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    ox,
                    oz,
                    5,
                    district_w,
                    district_d,
                    biome,
                    seed,
                );

                if hash2d_seeded(gx * 53, gz * 59, seed.wrapping_add(5005)) > 0.46 {
                    let tw = 14
                        + (hash2d_seeded(gx * 61, gz * 67, seed.wrapping_add(5006)) * 6.0) as i32;
                    let td = 14
                        + (hash2d_seeded(gx * 71, gz * 73, seed.wrapping_add(5007)) * 6.0) as i32;
                    let tox = (ox + district_w / 2 - tw / 2).clamp(1, WORLD_SIZE_X as i32 - tw - 1);
                    let toz = (oz + district_d / 2 - td / 2).clamp(1, WORLD_SIZE_Z as i32 - td - 1);
                    place_structure_in_chunk(
                        &mut chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        tox,
                        toz,
                        6,
                        tw,
                        td,
                        biome,
                        seed,
                    );
                }
            }
        }
    }

    // Phase 3b: Dense structures across all biomes
    let grid = 28;
    let min_gx = (chunk_wx - grid).div_euclid(grid) - 1;
    let max_gx = (chunk_wx + CHUNK_SIZE as i32 + grid).div_euclid(grid) + 1;
    let min_gz = (chunk_wz - grid).div_euclid(grid) - 1;
    let max_gz = (chunk_wz + CHUNK_SIZE as i32 + grid).div_euclid(grid) + 1;

    for gx in min_gx..=max_gx {
        for gz in min_gz..=max_gz {
            let sox = gx * grid + grid / 2;
            let soz = gz * grid + grid / 2;

            if sox < 0 || sox >= WORLD_SIZE_X as i32 || soz < 0 || soz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if in_spawn_safe_zone(sox, soz) {
                continue;
            }

            let biome = get_biome(sox, soz, seed);
            let density = match biome {
                Biome::Urban => 0.84,
                Biome::Forest => 0.74,
                Biome::Plains => 0.70,
                Biome::Desert => 0.60,
                Biome::Mountains => 0.64,
            };
            let roll = hash2d_seeded(gx * 127, gz * 131, seed.wrapping_add(6000));
            if roll > density {
                continue;
            }

            let type_roll = hash2d_seeded(gx * 71, gz * 83, seed.wrapping_add(6001));
            let size_roll = hash2d_seeded(gx * 43, gz * 59, seed.wrapping_add(6002));

            let mut sw = match biome {
                Biome::Urban => 10 + (size_roll * 12.0) as i32,
                Biome::Forest => 8 + (size_roll * 9.0) as i32,
                Biome::Plains => 8 + (size_roll * 10.0) as i32,
                Biome::Desert => 7 + (size_roll * 9.0) as i32,
                Biome::Mountains => 7 + (size_roll * 8.0) as i32,
            };
            let mut sd = match biome {
                Biome::Urban => {
                    10 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 12.0) as i32
                }
                Biome::Forest => {
                    8 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 9.0) as i32
                }
                Biome::Plains => {
                    8 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 10.0) as i32
                }
                Biome::Desert => {
                    7 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 9.0) as i32
                }
                Biome::Mountains => {
                    7 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 8.0) as i32
                }
            };

            let struct_type = match biome {
                Biome::Urban => {
                    if type_roll < 0.24 {
                        0
                    } else if type_roll < 0.43 {
                        1
                    } else if type_roll < 0.58 {
                        2
                    } else if type_roll < 0.72 {
                        3
                    } else if type_roll < 0.88 {
                        5
                    } else if type_roll < 0.95 {
                        6
                    } else {
                        4
                    }
                }
                Biome::Forest => {
                    if type_roll < 0.28 {
                        0
                    } else if type_roll < 0.52 {
                        2
                    } else if type_roll < 0.72 {
                        3
                    } else {
                        4
                    }
                }
                Biome::Desert => {
                    if type_roll < 0.33 {
                        2
                    } else if type_roll < 0.62 {
                        3
                    } else if type_roll < 0.82 {
                        0
                    } else {
                        4
                    }
                }
                Biome::Mountains => {
                    if type_roll < 0.26 {
                        1
                    } else if type_roll < 0.52 {
                        2
                    } else if type_roll < 0.78 {
                        0
                    } else {
                        4
                    }
                }
                Biome::Plains => {
                    if type_roll < 0.25 {
                        0
                    } else if type_roll < 0.50 {
                        2
                    } else if type_roll < 0.70 {
                        3
                    } else if type_roll < 0.86 {
                        5
                    } else {
                        4
                    }
                }
            };

            if struct_type == 5 {
                sw = sw.max(18);
                sd = sd.max(18);
            } else if struct_type == 6 {
                sw = sw.max(14);
                sd = sd.max(14);
            }

            let ox = (sox - sw / 2).clamp(1, WORLD_SIZE_X as i32 - sw - 1);
            let oz = (soz - sd / 2).clamp(1, WORLD_SIZE_Z as i32 - sd - 1);

            place_structure_in_chunk(
                &mut chunk_blocks,
                chunk_wx,
                chunk_wy,
                chunk_wz,
                ox,
                oz,
                struct_type,
                sw,
                sd,
                biome,
                seed,
            );
        }
    }

    rle_encode(&chunk_blocks)
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
            if out_idx >= output.len() {
                break;
            }
            output[out_idx] = val;
            out_idx += 1;
        }
        i += 2;
    }
}

// ── Structural Integrity (Load + Topple Model) ──
// Works on sparse chunk windows and produces deterministic collapse plans.

use std::collections::{HashMap, HashSet};

const MAX_BFS_NODES: usize = 20000;
const MAX_BFS_RADIUS: i32 = 36;
const MIN_COLLAPSE_BLOCKS: usize = 1;

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

pub struct StructuralCollapsePlan {
    pub blocks: Vec<(i32, i32, i32, u8)>,
    /// 0 = free-fall shear, 1 = rotational topple
    pub motion_mode: u8,
    pub pivot: (f32, f32, f32),
    pub axis: (f32, f32, f32),
    pub drift: (f32, f32, f32),
    pub fracture_origin: (f32, f32, f32),
    pub fracture_dir: (f32, f32, f32),
    pub ang_accel: f32,
    pub initial_ang_vel: f32,
    pub gravity_scale: f32,
    pub fracture_speed: f32,
    pub lifetime_ms: u32,
}

struct ComponentScan {
    blocks: Vec<(i32, i32, i32, u8)>,
    visited: Vec<u64>,
}

fn block_weight(bt: u8) -> f32 {
    match bt {
        CONCRETE => 3.0,
        DARK_CONCRETE => 3.5,
        ASPHALT => 2.5,
        REBAR => 4.0,
        BRICK => 2.0,
        METAL => 5.0,
        RUBBLE => 1.5,
        DIRT => 1.2,
        SAND => 1.0,
        GRASS => 1.0,
        WOOD => 1.6,
        STONE => 3.2,
        SNOW => 0.4,
        LANTERN => 0.45,
        _ => 2.0,
    }
}

fn normalize2(x: f32, z: f32) -> (f32, f32) {
    let len = (x * x + z * z).sqrt();
    if len < 0.0001 {
        (1.0, 0.0)
    } else {
        (x / len, z / len)
    }
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

fn analyze_component_for_collapse(
    chunks: &HashMap<u32, [u8; 4096]>,
    component: &ComponentScan,
) -> Option<StructuralCollapsePlan> {
    if component.blocks.len() < MIN_COLLAPSE_BLOCKS {
        return None;
    }

    let mut block_keys = HashSet::new();
    for &(x, y, z, _) in &component.blocks {
        block_keys.insert(pack_coord(x, y, z));
    }

    let mut total_w = 0.0f32;
    let mut com_x = 0.0f32;
    let mut com_z = 0.0f32;

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;

    let mut support_points: Vec<(f32, f32, f32)> = Vec::new();
    for &(x, y, z, bt) in &component.blocks {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        min_z = min_z.min(z);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        max_z = max_z.max(z);

        let w = block_weight(bt);
        total_w += w;
        com_x += (x as f32 + 0.5) * w;
        com_z += (z as f32 + 0.5) * w;

        if y == 0 {
            support_points.push((x as f32 + 0.5, z as f32 + 0.5, y as f32 + 0.5));
            continue;
        }

        let below_key = pack_coord(x, y - 1, z);
        if block_keys.contains(&below_key) {
            continue;
        }

        match get_block_sparse(chunks, x, y - 1, z) {
            Some(b) if b != AIR => {
                support_points.push((x as f32 + 0.5, z as f32 + 0.5, y as f32 + 0.5));
            }
            None => {
                support_points.push((x as f32 + 0.5, z as f32 + 0.5, y as f32 + 0.5));
            }
            Some(_) => {}
        }
    }

    if total_w <= 0.0 {
        return None;
    }

    com_x /= total_w;
    com_z /= total_w;

    let size = component.blocks.len() as f32;
    let footprint_w = (max_x - min_x + 1).max(1) as f32;
    let footprint_d = (max_z - min_z + 1).max(1) as f32;
    let footprint_area = footprint_w * footprint_d;
    let height = (max_y - min_y + 1).max(1) as f32;

    if support_points.is_empty() {
        let (dir_x, dir_z) = normalize2(
            com_x - (min_x as f32 + max_x as f32) * 0.5,
            com_z - (min_z as f32 + max_z as f32) * 0.5,
        );
        let fracture_origin = (
            if dir_x >= 0.0 {
                min_x as f32
            } else {
                (max_x + 1) as f32
            },
            min_y as f32,
            if dir_z >= 0.0 {
                min_z as f32
            } else {
                (max_z + 1) as f32
            },
        );
        return Some(StructuralCollapsePlan {
            blocks: component.blocks.clone(),
            motion_mode: 0,
            pivot: (com_x, min_y as f32 + 0.5, com_z),
            axis: (0.0, 0.0, 1.0),
            drift: (dir_x * 0.35, -0.8, dir_z * 0.35),
            fracture_origin,
            fracture_dir: (dir_x, 0.0, dir_z),
            ang_accel: 0.0,
            initial_ang_vel: 0.0,
            gravity_scale: 1.0,
            fracture_speed: 6.0,
            lifetime_ms: 5600,
        });
    }

    let mut support_x = 0.0f32;
    let mut support_z = 0.0f32;
    let mut support_y = 0.0f32;
    for &(sx, sz, sy) in &support_points {
        support_x += sx;
        support_z += sz;
        support_y += sy;
    }
    support_x /= support_points.len() as f32;
    support_z /= support_points.len() as f32;
    support_y /= support_points.len() as f32;

    let mut support_radius = 0.0f32;
    for &(sx, sz, _) in &support_points {
        let dx = sx - support_x;
        let dz = sz - support_z;
        support_radius = support_radius.max((dx * dx + dz * dz).sqrt());
    }
    support_radius = support_radius.max(0.75);

    let support_density = (support_points.len() as f32 / footprint_area).min(1.0);
    let mass_per_support = total_w / support_points.len() as f32;
    let slenderness = height / footprint_area.sqrt().max(1.0);

    let load_dx = com_x - support_x;
    let load_dz = com_z - support_z;
    let overload_dist = (load_dx * load_dx + load_dz * load_dz).sqrt();
    let overload_ratio = overload_dist / (support_radius + 0.25);

    let instability = overload_ratio * 1.05
        + (0.62 - support_density).max(0.0) * 0.95
        + (mass_per_support * 0.017)
        + (slenderness * 0.08);

    if instability < 1.18 && overload_ratio < 1.02 {
        return None;
    }

    let (load_dir_x, load_dir_z) = normalize2(load_dx, load_dz);
    let fracture_dir_x = -load_dir_x;
    let fracture_dir_z = -load_dir_z;
    let axis_x = load_dir_z;
    let axis_z = -load_dir_x;

    let collapse_strength = (instability - 0.95).max(0.0);
    let ang_accel = (0.18 + collapse_strength * 0.85 + slenderness * 0.02).min(2.4);
    let initial_ang_vel = (0.03 + overload_ratio * 0.2).min(0.5);
    let lateral_drift = (0.10 + overload_ratio * 0.25).min(0.65);
    let fracture_speed = (2.2 + support_density * 2.0 + (size / 150.0)).min(8.0);

    let lifetime_ms =
        (5200.0 + height * 55.0 + collapse_strength * 900.0).clamp(4200.0, 9800.0) as u32;

    let fracture_origin = (
        if fracture_dir_x >= 0.0 {
            min_x as f32
        } else {
            (max_x + 1) as f32
        },
        min_y as f32,
        if fracture_dir_z >= 0.0 {
            min_z as f32
        } else {
            (max_z + 1) as f32
        },
    );

    Some(StructuralCollapsePlan {
        blocks: component.blocks.clone(),
        motion_mode: 1,
        pivot: (support_x, support_y, support_z),
        axis: (axis_x, 0.0, axis_z),
        drift: (
            load_dir_x * lateral_drift,
            -0.55,
            load_dir_z * lateral_drift,
        ),
        fracture_origin,
        fracture_dir: (fracture_dir_x, 0.0, fracture_dir_z),
        ang_accel,
        initial_ang_vel,
        gravity_scale: 0.85,
        fracture_speed,
        lifetime_ms,
    })
}

/// Check structural integrity using sparse chunk data.
/// Takes a map of nearby decompressed chunks and positions of destroyed blocks.
/// Returns deterministic collapse plans for unsupported/overloaded structures.
pub fn check_structural_integrity_sparse(
    chunks: &HashMap<u32, [u8; 4096]>,
    destroyed_positions: &[(i32, i32, i32)],
) -> Vec<StructuralCollapsePlan> {
    let mut plans = Vec::new();
    let mut global_visited = HashSet::new();

    for &(px, py, pz) in destroyed_positions {
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

            let result = scan_component_sparse(chunks, nx, ny, nz, &global_visited);
            for &k in &result.visited {
                global_visited.insert(k);
            }

            if let Some(plan) = analyze_component_for_collapse(chunks, &result) {
                plans.push(plan);
            }
        }
    }

    plans
}

// ── Chunk ID helpers ──

pub fn pack_chunk_id(cx: u8, cy: u8, cz: u8) -> u32 {
    cx as u32 | ((cy as u32) << 8) | ((cz as u32) << 16)
}

pub fn unpack_chunk_id(id: u32) -> (u8, u8, u8) {
    (
        (id & 0xFF) as u8,
        ((id >> 8) & 0xFF) as u8,
        ((id >> 16) & 0xFF) as u8,
    )
}

/// Inject decompressed chunk data into a flat world array (used for legacy compat if needed).
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
