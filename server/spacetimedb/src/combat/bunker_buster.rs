// ── Bunker Buster Mechanic ──
// Drilling bomb: penetrates downward through terrain, then detonates underground
// in an oblate spheroid. Used by the fighter jet's primary weapon.

use spacetimedb::{Identity, ReducerContext};

use crate::chunks::{destroy_blocks_in_world, run_structural_check};
use crate::combat::damage::{
    apply_splash_player_damage, apply_splash_vehicle_damage, emit_explosion,
};
use crate::combat::projectile::{collect_all_player_ids, collect_all_vehicle_ids};
use crate::constants::max_block_destroy_per_call;
use crate::helpers::*;
use crate::types::*;
use crate::worldgen::{AIR, BEDROCK};

/// Drill downward from impact_pos, then detonate with massive destruction.
///
/// 1. Drill a 5x5 cross column (Manhattan distance <= 2) downward up to 20 blocks deep.
///    Stop at bedrock or 3+ consecutive air blocks (open cavity).
/// 2. Detonate at the final drill depth in an oblate spheroid
///    (horizontal radius 16, vertical radius 7).
/// 3. Blast upward from detonation back to surface (5x5 column).
/// 4. Surface eruption crater (sphere radius 3).
/// 5. Apply splash damage to players and vehicles near detonation.
/// 6. Emit explosion events: small surface + big underground.
/// 7. Run structural check on all destroyed positions.
pub fn bunker_buster_drill_and_detonate(
    ctx: &ReducerContext,
    sender: Identity,
    impact_pos: &Vec3,
    damage: i32,
    _weapon_radius: f32,
    weapon_code: u8,
    source_vehicle_id: u64,
) {
    let max_drill_depth: i32 = 20;

    // Phase 1: Drill downward (5x5 cross: Manhattan distance <= 2)
    let start_y = impact_pos.y.floor() as i32;
    let center_x = impact_pos.x.floor() as i32;
    let center_z = impact_pos.z.floor() as i32;

    let mut drill_blocks: Vec<(i32, i32, i32)> = Vec::new();
    let mut final_y = start_y;
    let mut consecutive_air = 0i32;

    for dy in 0..max_drill_depth {
        let y = start_y - dy;
        if y < 0 {
            break;
        }

        let mut all_air = true;
        let mut hit_bedrock = false;

        for dx in -2i32..=2 {
            for dz in -2i32..=2 {
                if dx.abs() + dz.abs() > 2 {
                    continue; // Plus/diamond shape
                }
                let bx = center_x + dx;
                let bz = center_z + dz;
                if !block_in_bounds(bx, y, bz) {
                    continue;
                }
                if let Some(bt) = get_block_type(ctx, bx, y, bz) {
                    if bt == BEDROCK {
                        hit_bedrock = true;
                    } else if bt != AIR {
                        all_air = false;
                        drill_blocks.push((bx, y, bz));
                    }
                }
            }
        }

        if hit_bedrock {
            final_y = y + 1;
            break;
        }

        if all_air {
            consecutive_air += 1;
            if consecutive_air >= 3 {
                final_y = y + 2; // detonate just above the cavity
                break;
            }
        } else {
            consecutive_air = 0;
        }

        final_y = y;
    }

    // Destroy the drill column blocks
    let drill_destroyed = destroy_blocks_in_world(ctx, &drill_blocks);

    // Phase 2: Detonate at final drill position
    let detonation_pos = Vec3 {
        x: impact_pos.x,
        y: final_y as f32,
        z: impact_pos.z,
    };

    let horiz_radius: f32 = 16.0;
    let vert_radius: f32 = 7.0;
    let hr2 = horiz_radius * horiz_radius;
    let vr2 = vert_radius * vert_radius;
    let max_blocks = max_block_destroy_per_call();

    let mut blast_coords: Vec<(i32, i32, i32)> = Vec::new();
    let det_x = detonation_pos.x;
    let det_y = detonation_pos.y;
    let det_z = detonation_pos.z;

    // Phase 2a: Oblate spheroid detonation
    for bx in (det_x - horiz_radius).floor() as i32..=(det_x + horiz_radius).ceil() as i32 {
        for by in (det_y - vert_radius).floor() as i32..=(det_y + vert_radius).ceil() as i32 {
            for bz in (det_z - horiz_radius).floor() as i32..=(det_z + horiz_radius).ceil() as i32
            {
                let dx = bx as f32 - det_x;
                let dy = by as f32 - det_y;
                let dz = bz as f32 - det_z;
                if ((dx * dx + dz * dz) / hr2 + (dy * dy) / vr2 <= 1.0)
                    && block_in_bounds(bx, by, bz)
                {
                    blast_coords.push((bx, by, bz));
                    if blast_coords.len() >= max_blocks {
                        break;
                    }
                }
            }
            if blast_coords.len() >= max_blocks {
                break;
            }
        }
        if blast_coords.len() >= max_blocks {
            break;
        }
    }

    // Phase 2b: Upward blast column from detonation back to surface (5x5 cross)
    for y in final_y..=start_y {
        for dx in -2i32..=2 {
            for dz in -2i32..=2 {
                if dx.abs() + dz.abs() > 2 {
                    continue;
                }
                let bx = center_x + dx;
                let bz = center_z + dz;
                if block_in_bounds(bx, y, bz) && blast_coords.len() < max_blocks {
                    blast_coords.push((bx, y, bz));
                }
            }
        }
    }

    // Phase 2c: Surface eruption crater (sphere radius 3)
    let erupt_r: f32 = 3.0;
    let erupt_r2 = erupt_r * erupt_r;
    for bx in (center_x as f32 - erupt_r).floor() as i32..=(center_x as f32 + erupt_r).ceil() as i32 {
        for by in (start_y as f32 - erupt_r).floor() as i32..=(start_y as f32 + erupt_r).ceil() as i32 {
            for bz in (center_z as f32 - erupt_r).floor() as i32..=(center_z as f32 + erupt_r).ceil() as i32 {
                let dx = bx as f32 - center_x as f32;
                let dy = by as f32 - start_y as f32;
                let dz = bz as f32 - center_z as f32;
                if dx * dx + dy * dy + dz * dz <= erupt_r2
                    && block_in_bounds(bx, by, bz)
                    && blast_coords.len() < max_blocks
                {
                    blast_coords.push((bx, by, bz));
                }
            }
        }
    }

    let blast_destroyed = destroy_blocks_in_world(ctx, &blast_coords);

    // Phase 3: Splash damage at detonation point
    let hit_players = collect_all_player_ids(ctx);
    let hit_vehicles = collect_all_vehicle_ids(ctx);
    apply_splash_player_damage(
        ctx,
        sender,
        &detonation_pos,
        &hit_players,
        damage,
        horiz_radius,
        weapon_code,
    );
    apply_splash_vehicle_damage(
        ctx,
        sender,
        &detonation_pos,
        &hit_vehicles,
        source_vehicle_id,
        damage,
        horiz_radius,
        weapon_code,
    );

    // Phase 4: Emit two explosion events
    // Small surface explosion
    emit_explosion(
        ctx,
        sender,
        impact_pos,
        3.0,
        weapon_code,
        &drill_destroyed,
    );
    // Big underground detonation
    emit_explosion(
        ctx,
        sender,
        &detonation_pos,
        horiz_radius,
        weapon_code,
        &blast_destroyed,
    );

    // Phase 5: Structural check on all destroyed positions
    let mut all_destroyed_positions: Vec<(i32, i32, i32)> = drill_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    all_destroyed_positions.extend(blast_destroyed.iter().map(|&(x, y, z, _)| (x, y, z)));
    run_structural_check(ctx, &all_destroyed_positions);

    log::info!(
        "[BUNKER_BUSTER] surface=({:.1},{:.1},{:.1}) detonation=({:.1},{:.1},{:.1}) drill={} blast={}",
        impact_pos.x, impact_pos.y, impact_pos.z,
        detonation_pos.x, detonation_pos.y, detonation_pos.z,
        drill_destroyed.len(),
        blast_destroyed.len(),
    );
}
