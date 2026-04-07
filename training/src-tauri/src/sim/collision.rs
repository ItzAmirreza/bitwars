//! Voxel collision detection — 1:1 port of client/src/game/VoxelCollision.ts
//!
//! All constants and logic match the client exactly:
//! - PLAYER_HALF_WIDTH = 0.3
//! - STEP_HEIGHT = 0.6
//! - WALL_CLIMB_SPEED = 4.0
//! - X-then-Z axis resolution order
//! - 5-point ground sampling

use super::world::EnvTerrain;
use crate::worldgen::AIR;

pub const PLAYER_HALF_WIDTH: f32 = 0.3;
pub const STEP_HEIGHT: f32 = 0.6;
pub const WALL_CLIMB_SPEED: f32 = 4.0;
const WALL_CHECK_DIST: f32 = 0.1;

pub struct CollisionResult {
    pub new_x: f32,
    pub new_z: f32,
    pub collided_x: bool,
    pub collided_z: bool,
}

/// Check if player AABB is against a wall on any cardinal side.
/// Matches client's isAgainstWall() exactly.
pub fn is_against_wall(
    world: &EnvTerrain,
    cx: f32,
    cz: f32,
    foot_y: f32,
    player_height: f32,
) -> bool {
    let check_dist = PLAYER_HALF_WIDTH + WALL_CHECK_DIST;

    let mut y_off = 0.2f32;
    while y_off < player_height - 0.1 {
        let by = (foot_y + y_off).floor() as i32;
        if world.get_block((cx + check_dist).floor() as i32, by, cz.floor() as i32) != AIR {
            return true;
        }
        if world.get_block((cx - check_dist).floor() as i32, by, cz.floor() as i32) != AIR {
            return true;
        }
        if world.get_block(cx.floor() as i32, by, (cz + check_dist).floor() as i32) != AIR {
            return true;
        }
        if world.get_block(cx.floor() as i32, by, (cz - check_dist).floor() as i32) != AIR {
            return true;
        }
        y_off += 0.5;
    }
    false
}

/// Horizontal collision: resolve movement against voxel blocks.
/// Matches client's moveWithCollision() exactly.
/// Resolution order: X axis first, then Z axis using resolved X.
pub fn move_with_collision(
    world: &EnvTerrain,
    pos_x: f32,
    pos_z: f32,
    dx: f32,
    dz: f32,
    foot_y: f32,
    player_height: f32,
) -> CollisionResult {
    let min_by = (foot_y + STEP_HEIGHT).floor() as i32;
    let max_by = (foot_y + player_height - 0.01).floor() as i32;

    // Resolve X axis
    let mut new_x = pos_x + dx;
    let mut collided_x = false;
    'x_loop: for bx in (new_x - PLAYER_HALF_WIDTH).floor() as i32
        ..=(new_x + PLAYER_HALF_WIDTH).floor() as i32
    {
        for by in min_by..=max_by {
            for bz in
                (pos_z - PLAYER_HALF_WIDTH).floor() as i32..=(pos_z + PLAYER_HALF_WIDTH).floor() as i32
            {
                if world.get_block(bx, by, bz) != AIR {
                    collided_x = true;
                    if dx > 0.0 {
                        new_x = bx as f32 - PLAYER_HALF_WIDTH - 0.001;
                    } else {
                        new_x = bx as f32 + 1.0 + PLAYER_HALF_WIDTH + 0.001;
                    }
                    break 'x_loop;
                }
            }
        }
    }

    // Resolve Z axis (using resolved X)
    let mut new_z = pos_z + dz;
    let mut collided_z = false;
    'z_loop: for bx in (new_x - PLAYER_HALF_WIDTH).floor() as i32
        ..=(new_x + PLAYER_HALF_WIDTH).floor() as i32
    {
        for by in min_by..=max_by {
            for bz in (new_z - PLAYER_HALF_WIDTH).floor() as i32
                ..=(new_z + PLAYER_HALF_WIDTH).floor() as i32
            {
                if world.get_block(bx, by, bz) != AIR {
                    collided_z = true;
                    if dz > 0.0 {
                        new_z = bz as f32 - PLAYER_HALF_WIDTH - 0.001;
                    } else {
                        new_z = bz as f32 + 1.0 + PLAYER_HALF_WIDTH + 0.001;
                    }
                    break 'z_loop;
                }
            }
        }
    }

    CollisionResult {
        new_x,
        new_z,
        collided_x,
        collided_z,
    }
}

/// Ceiling collision: prevent jumping through blocks above.
/// Matches client's checkCeiling() exactly.
pub fn check_ceiling(
    world: &EnvTerrain,
    pos_x: f32,
    pos_z: f32,
    velocity_y: f32,
    foot_y: f32,
    player_height: f32,
    current_eye_height: f32,
) -> Option<(f32, f32)> {
    if velocity_y <= 0.0 {
        return None;
    }
    let head_y = (foot_y + player_height).floor() as i32;

    let min_bx = (pos_x - PLAYER_HALF_WIDTH).floor() as i32;
    let max_bx = (pos_x + PLAYER_HALF_WIDTH).floor() as i32;
    let min_bz = (pos_z - PLAYER_HALF_WIDTH).floor() as i32;
    let max_bz = (pos_z + PLAYER_HALF_WIDTH).floor() as i32;

    for bx in min_bx..=max_bx {
        for bz in min_bz..=max_bz {
            if world.get_block(bx, head_y, bz) != AIR {
                let camera_y = head_y as f32 - player_height + current_eye_height - 0.001;
                return Some((camera_y, 0.0));
            }
        }
    }
    None
}

/// Get the ground height using multi-point sampling.
/// Matches client's getGroundLevel() exactly — 5-point sampling pattern.
pub fn get_ground_level(world: &EnvTerrain, pos_x: f32, pos_z: f32, foot_y: f32) -> f32 {
    let scan_y = foot_y + STEP_HEIGHT + 1.0;
    let hw = PLAYER_HALF_WIDTH - 0.01;

    let mut max_ground = f32::NEG_INFINITY;
    let points = [
        (pos_x, pos_z),
        (pos_x - hw, pos_z - hw),
        (pos_x + hw, pos_z - hw),
        (pos_x - hw, pos_z + hw),
        (pos_x + hw, pos_z + hw),
    ];

    for (sx, sz) in points {
        let top = world.get_ground_height_below(sx, scan_y, sz);
        let h = if top >= 0 { top as f32 + 1.0 } else { 0.0 };
        if h > max_ground {
            max_ground = h;
        }
    }
    max_ground
}

