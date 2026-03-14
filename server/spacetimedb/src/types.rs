// ── Shared Types ──
// Core data types used across all server modules.

use spacetimedb::SpacetimeType;

/// 3D vector used for positions, velocities, and directions.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// A block that was destroyed, with its position and former type.
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct DestroyedBlock {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub block_type: u8,
}

/// Rotation in yaw/pitch (no roll for FPS characters).
#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Rotation {
    pub yaw: f32,
    pub pitch: f32,
}

/// Zero velocity constant for convenience.
pub const ZERO_VEL: Vec3 = Vec3 {
    x: 0.0,
    y: 0.0,
    z: 0.0,
};

/// Convert a tuple to Vec3.
pub fn vec3_from_tuple(v: (f32, f32, f32)) -> Vec3 {
    Vec3 {
        x: v.0,
        y: v.1,
        z: v.2,
    }
}
