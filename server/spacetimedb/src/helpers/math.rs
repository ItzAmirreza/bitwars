// ── Math Helpers ──
// Pure math functions: distance, raycasting, hashing, normalization.

use spacetimedb::Timestamp;

use crate::types::*;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z};

pub fn timestamp_micros(ts: Timestamp) -> u64 {
    ts.to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64
}

pub fn dist_sq(a: &Vec3, b: &Vec3) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    dx * dx + dy * dy + dz * dz
}

pub fn ray_aabb_t(origin: &Vec3, direction: &Vec3, min: &Vec3, max: &Vec3) -> Option<f32> {
    let inv_x = if direction.x != 0.0 {
        1.0 / direction.x
    } else if direction.x >= 0.0 {
        f32::INFINITY
    } else {
        f32::NEG_INFINITY
    };
    let inv_y = if direction.y != 0.0 {
        1.0 / direction.y
    } else if direction.y >= 0.0 {
        f32::INFINITY
    } else {
        f32::NEG_INFINITY
    };
    let inv_z = if direction.z != 0.0 {
        1.0 / direction.z
    } else if direction.z >= 0.0 {
        f32::INFINITY
    } else {
        f32::NEG_INFINITY
    };

    let t1 = (min.x - origin.x) * inv_x;
    let t2 = (max.x - origin.x) * inv_x;
    let t3 = (min.y - origin.y) * inv_y;
    let t4 = (max.y - origin.y) * inv_y;
    let t5 = (min.z - origin.z) * inv_z;
    let t6 = (max.z - origin.z) * inv_z;

    let tmin = f32::max(
        f32::max(f32::min(t1, t2), f32::min(t3, t4)),
        f32::min(t5, t6),
    );
    let tmax = f32::min(
        f32::min(f32::max(t1, t2), f32::max(t3, t4)),
        f32::max(t5, t6),
    );

    if tmax < 0.0 || tmin > tmax {
        return None;
    }
    if tmin >= 0.0 {
        Some(tmin)
    } else {
        Some(tmax)
    }
}

pub fn normalize_direction(direction: &Vec3) -> (Vec3, f32) {
    let len =
        (direction.x * direction.x + direction.y * direction.y + direction.z * direction.z).sqrt();
    if len > 0.01 {
        (
            Vec3 {
                x: direction.x / len,
                y: direction.y / len,
                z: direction.z / len,
            },
            len,
        )
    } else {
        (ZERO_VEL, 0.0)
    }
}

pub fn hash_u64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

pub fn unit_from_seed(seed: u64) -> f32 {
    ((hash_u64(seed) & 0xffff_ffff) as f64 / 4_294_967_295.0) as f32
}

pub fn clamp_pos(pos: &Vec3) -> Vec3 {
    Vec3 {
        x: pos.x.clamp(-1.0, (WORLD_SIZE_X + 1) as f32),
        y: pos.y.clamp(-10.0, 100.0),
        z: pos.z.clamp(-1.0, (WORLD_SIZE_Z + 1) as f32),
    }
}

pub fn block_in_bounds(x: i32, y: i32, z: i32) -> bool {
    x >= 0
        && x < WORLD_SIZE_X as i32
        && y >= 0
        && y < WORLD_SIZE_Y as i32
        && z >= 0
        && z < WORLD_SIZE_Z as i32
}

pub fn get_block_type(ctx: &spacetimedb::ReducerContext, x: i32, y: i32, z: i32) -> Option<u8> {
    use crate::chunks::get_or_generate_decoded_chunk;
    use crate::worldgen::{AIR, CHUNK_SIZE};

    if !block_in_bounds(x, y, z) {
        return Some(AIR);
    }
    let ux = x as usize;
    let uy = y as usize;
    let uz = z as usize;
    let cx = (ux / CHUNK_SIZE) as u8;
    let cy = (uy / CHUNK_SIZE) as u8;
    let cz = (uz / CHUNK_SIZE) as u8;
    let decoded = get_or_generate_decoded_chunk(ctx, cx, cy, cz)?;
    Some(
        decoded[ux % CHUNK_SIZE
            + (uy % CHUNK_SIZE) * CHUNK_SIZE
            + (uz % CHUNK_SIZE) * CHUNK_SIZE * CHUNK_SIZE],
    )
}

pub fn is_grounded(ctx: &spacetimedb::ReducerContext, pos: &Vec3) -> bool {
    use crate::constants::{player_eye_height, player_foot_radius};
    use crate::worldgen::AIR;

    let foot_y = pos.y - player_eye_height();
    let probe_y = (foot_y - 0.05).floor() as i32;
    let foot_r = player_foot_radius();
    let probes = [
        (pos.x, pos.z),
        (pos.x - foot_r, pos.z - foot_r),
        (pos.x + foot_r, pos.z - foot_r),
        (pos.x - foot_r, pos.z + foot_r),
        (pos.x + foot_r, pos.z + foot_r),
    ];
    probes.iter().any(|(px, pz)| {
        let bx = px.floor() as i32;
        let bz = pz.floor() as i32;
        matches!(get_block_type(ctx, bx, probe_y, bz), Some(bt) if bt != AIR)
    })
}
