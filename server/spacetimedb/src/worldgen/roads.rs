use super::biomes::Biome;
use super::noise::hash2d_seeded;
use super::*;

// ── Road Generation ──

pub fn is_road(wx: i32, wz: i32, _seed: u64) -> Option<u8> {
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

pub fn should_place_road_lantern(wx: i32, wz: i32, biome: Biome, seed: u64) -> bool {
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

pub fn place_lantern_post(
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

pub fn place_rooftop_lantern(
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
