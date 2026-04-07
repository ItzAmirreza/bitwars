//! Explosion knockback calculation for training simulation.
//!
//! Matches client/src/game/InfantryFireController.ts applyExplosionKnockback()
//! exactly — same distance falloff, proximity boost, and updraft formula.

/// Compute explosion knockback impulse matching the real game client.
///
/// Formula from InfantryFireController.applyExplosionKnockback():
/// - bodyY = playerY - 0.9 (body center, not eye)
/// - maxDist = radius * 3.4
/// - proximity = 1 - dist / maxDist
/// - falloff = proximity^2
/// - coreBoost = 1 + proximity * 0.35
/// - baseKnockback = damage * (0.2 + radius * 0.022)
/// - knockback = baseKnockback * falloff * coreBoost
/// - updraft = knockback * 0.12 * belowFactor (when explosion is below body)
///
/// Returns (impulse_x, impulse_y, impulse_z) to apply to player velocity.
pub fn apply_explosion_knockback(
    player_pos: (f32, f32, f32),
    explosion_pos: (f32, f32, f32),
    radius: f32,
    damage: f32,
) -> (f32, f32, f32) {
    // Use body center instead of camera eye so side blasts stay mostly horizontal
    let body_y = player_pos.1 - 0.9;

    let dx = player_pos.0 - explosion_pos.0;
    let dy = body_y - explosion_pos.1;
    let dz = player_pos.2 - explosion_pos.2;
    let dist = (dx * dx + dy * dy + dz * dz).sqrt();

    let max_dist = radius * 3.4;
    if dist >= max_dist || dist < 0.01 {
        return (0.0, 0.0, 0.0);
    }

    let proximity = 1.0 - dist / max_dist;
    let falloff = proximity * proximity;
    let core_boost = 1.0 + proximity * 0.35;

    let base_knockback = damage * (0.2 + radius * 0.022);
    let knockback = base_knockback * falloff * core_boost;

    // Radial impulse away from blast center
    let nx = dx / dist;
    let ny = dy / dist;
    let nz = dz / dist;

    // Small ground-coupling lift when explosion is below body center
    let below_factor = ((body_y - explosion_pos.1) / (radius + 1.2)).clamp(0.0, 1.0);
    let updraft = knockback * 0.12 * below_factor;

    (nx * knockback, ny * knockback + updraft, nz * knockback)
}
