// ── Kinetic Penetrator ──
// Hitscan weapon fired straight down from the fighter jet.
// Punches a narrow 3x3 column through terrain, then detonates at the base.

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

/// Kinetic penetrator strike: instant hitscan column + base detonation.
///
/// 1. Drill a 3x3 column downward from impact_pos (up to 30 blocks or bedrock).
/// 2. Detonate a sphere (radius = weapon radius) at the bottom of the shaft.
/// 3. Apply splash damage to players and vehicles near the detonation.
/// 4. Emit explosion events (surface + underground).
/// 5. Run structural integrity check on all destroyed positions.
pub fn kinetic_penetrator_strike(
    ctx: &ReducerContext,
    sender: Identity,
    impact_pos: &Vec3,
    damage: i32,
    radius: f32,
    weapon_code: u8,
    source_vehicle_id: u64,
) {
    let max_drill_depth: i32 = 30;
    let max_blocks = max_block_destroy_per_call();

    let start_y = impact_pos.y.floor() as i32;
    let center_x = impact_pos.x.floor() as i32;
    let center_z = impact_pos.z.floor() as i32;

    // Phase 1: Drill 3x3 column downward
    let mut drill_blocks: Vec<(i32, i32, i32)> = Vec::new();
    let mut final_y = start_y;

    for dy in 0..max_drill_depth {
        let y = start_y - dy;
        if y < 0 {
            break;
        }

        let mut hit_bedrock = false;
        for dx in -1i32..=1 {
            for dz in -1i32..=1 {
                let bx = center_x + dx;
                let bz = center_z + dz;
                if !block_in_bounds(bx, y, bz) {
                    continue;
                }
                if let Some(bt) = get_block_type(ctx, bx, y, bz) {
                    if bt == BEDROCK {
                        hit_bedrock = true;
                    } else if bt != AIR {
                        drill_blocks.push((bx, y, bz));
                    }
                }
            }
        }

        if hit_bedrock {
            final_y = y + 1;
            break;
        }
        final_y = y;
    }

    let drill_destroyed = destroy_blocks_in_world(ctx, &drill_blocks);

    // Phase 2: Foundation explosion (sphere at bottom of shaft)
    let detonation_pos = Vec3 {
        x: impact_pos.x,
        y: final_y as f32,
        z: impact_pos.z,
    };

    let r2 = radius * radius;
    let mut blast_coords: Vec<(i32, i32, i32)> = Vec::new();
    let det_x = detonation_pos.x;
    let det_y = detonation_pos.y;
    let det_z = detonation_pos.z;

    for bx in (det_x - radius).floor() as i32..=(det_x + radius).ceil() as i32 {
        for by in (det_y - radius).floor() as i32..=(det_y + radius).ceil() as i32 {
            for bz in (det_z - radius).floor() as i32..=(det_z + radius).ceil() as i32 {
                let dx = bx as f32 - det_x;
                let dy = by as f32 - det_y;
                let dz = bz as f32 - det_z;
                if dx * dx + dy * dy + dz * dz <= r2 && block_in_bounds(bx, by, bz) {
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
        radius,
        weapon_code,
    );
    apply_splash_vehicle_damage(
        ctx,
        sender,
        &detonation_pos,
        &hit_vehicles,
        source_vehicle_id,
        damage,
        radius,
        weapon_code,
    );

    // Phase 4: Emit explosion events
    // Small surface impact
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
        radius,
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
        "[KINETIC_PENETRATOR] surface=({:.1},{:.1},{:.1}) detonation=({:.1},{:.1},{:.1}) drill={} blast={}",
        impact_pos.x, impact_pos.y, impact_pos.z,
        detonation_pos.x, detonation_pos.y, detonation_pos.z,
        drill_destroyed.len(),
        blast_destroyed.len(),
    );
}
