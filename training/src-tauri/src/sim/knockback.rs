//! Explosion knockback and self-damage calculation for training simulation.
//!
//! Knockback formula matches the server grenade push pattern from grenades.rs.
//! Self-damage uses distance falloff with a 0.5x multiplier for own explosions.

/// Base knockback force (tunable).
pub const KNOCKBACK_FORCE: f32 = 20.0;

/// Compute explosion knockback impulse.
///
/// Formula matching grenade push pattern from server/grenades.rs:
/// - dx, dy, dz = player_pos - explosion_pos
/// - dist = sqrt(dx^2 + dy^2 + dz^2).max(0.5)
/// - force = (1.0 - dist/radius).max(0.0) * KNOCKBACK_FORCE
/// - nx = dx/dist, ny = (dy/dist).max(0.3), nz = dz/dist  (min 30% upward bias)
/// - impulse = (nx*force, ny*force, nz*force)
///
/// Returns (impulse_x, impulse_y, impulse_z) to apply to player velocity.
pub fn apply_explosion_knockback(
    player_pos: (f32, f32, f32),
    explosion_pos: (f32, f32, f32),
    radius: f32,
) -> (f32, f32, f32) {
    let dx = player_pos.0 - explosion_pos.0;
    let dy = player_pos.1 - explosion_pos.1;
    let dz = player_pos.2 - explosion_pos.2;
    let dist = (dx * dx + dy * dy + dz * dz).sqrt().max(0.5);

    let force = (1.0 - dist / radius).max(0.0) * KNOCKBACK_FORCE;
    if force <= 0.0 {
        return (0.0, 0.0, 0.0);
    }

    let nx = dx / dist;
    let ny = (dy / dist).max(0.3); // min 30% upward bias
    let nz = dz / dist;

    (nx * force, ny * force, nz * force)
}


