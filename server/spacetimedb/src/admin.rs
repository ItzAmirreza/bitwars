// ── Admin Commands ──
// Chat-based admin commands processed from /send_chat.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;

const ADMIN_USERNAME: &str = "amir";
const ADMIN_HELP_TEXT: &str = "Admin commands:\n/tp <player> or /tp <x> <y> <z>\n/tphere <player>\n/kill <player>\n/heal [player]\n/god\n/fly\n/ammo\n/weather <0-4>\n/time <0-24>\n/announce <message>\n/killall\n/respawnall";

pub fn is_admin(username: &str) -> bool {
    username.to_lowercase() == ADMIN_USERNAME
}

fn find_player_by_name(ctx: &ReducerContext, name: &str) -> Option<Player> {
    let name_lower = name.to_lowercase();
    ctx.db
        .player()
        .iter()
        .find(|p| p.username.to_lowercase() == name_lower)
}

fn insert_system_message(ctx: &ReducerContext, text: &str) {
    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender: ctx.sender(),
        sender_name: "[SERVER]".to_string(),
        text: text.to_string(),
        sent_at: ctx.timestamp,
    });
}

pub fn insert_admin_help(ctx: &ReducerContext) {
    insert_system_message(ctx, ADMIN_HELP_TEXT);
}

fn insert_command_help(ctx: &ReducerContext, reason: &str) {
    insert_system_message(ctx, &format!("{}\n\n{}", reason, ADMIN_HELP_TEXT));
}

pub fn process_admin_command(
    ctx: &ReducerContext,
    sender: Identity,
    text: &str,
) -> Result<(), String> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.is_empty() {
        insert_admin_help(ctx);
        return Ok(());
    }

    let cmd = parts[0].to_lowercase();

    match cmd.as_str() {
        "/tp" => {
            if parts.len() == 4 {
                let x: f32 = parts[1]
                    .parse()
                    .map_err(|_| "Invalid x coordinate".to_string())?;
                let y: f32 = parts[2]
                    .parse()
                    .map_err(|_| "Invalid y coordinate".to_string())?;
                let z: f32 = parts[3]
                    .parse()
                    .map_err(|_| "Invalid z coordinate".to_string())?;
                let new_pos = Vec3 { x, y, z };
                let player = ctx
                    .db
                    .player()
                    .identity()
                    .find(sender)
                    .ok_or("Not registered")?;
                let player = dismount_player_internal(ctx, player, true);
                let next = Player {
                    pos: new_pos.clone(),
                    ..player
                };
                ctx.db.player().identity().update(next.clone());
                sync_player_entity(ctx, &next);
                init_movement_state(ctx, sender, &new_pos);
                insert_system_message(
                    ctx,
                    &format!("Teleported to ({:.1}, {:.1}, {:.1})", x, y, z),
                );
            } else if parts.len() == 2 {
                let target =
                    find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
                let target_pos = target.pos.clone();
                let target_name = target.username.clone();
                let player = ctx
                    .db
                    .player()
                    .identity()
                    .find(sender)
                    .ok_or("Not registered")?;
                let player = dismount_player_internal(ctx, player, true);
                let next = Player {
                    pos: target_pos.clone(),
                    ..player
                };
                ctx.db.player().identity().update(next.clone());
                sync_player_entity(ctx, &next);
                init_movement_state(ctx, sender, &target_pos);
                insert_system_message(ctx, &format!("Teleported to {}", target_name));
            } else {
                insert_command_help(ctx, "Usage: /tp <player> or /tp <x> <y> <z>");
                return Ok(());
            }
            Ok(())
        }

        "/tphere" | "/summon" => {
            if parts.len() != 2 {
                insert_command_help(ctx, "Usage: /tphere <player>");
                return Ok(());
            }
            let admin = ctx
                .db
                .player()
                .identity()
                .find(sender)
                .ok_or("Not registered")?;
            let admin_pos = admin.pos.clone();
            let target =
                find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
            let target = dismount_player_internal(ctx, target, true);
            let target_identity = target.identity;
            let target_name = target.username.clone();
            let moved = Player {
                pos: admin_pos.clone(),
                ..target
            };
            ctx.db.player().identity().update(moved.clone());
            sync_player_entity(ctx, &moved);
            init_movement_state(ctx, target_identity, &admin_pos);
            insert_system_message(ctx, &format!("Summoned {} to your location", target_name));
            Ok(())
        }

        "/kill" => {
            if parts.len() != 2 {
                insert_command_help(ctx, "Usage: /kill <player>");
                return Ok(());
            }
            let target =
                find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
            let target_name = target.username.clone();
            let target = dismount_player_internal(ctx, target, true);
            let killed = Player {
                health: 0,
                deaths: target.deaths + 1,
                last_damage_time: ctx.timestamp,
                ..target
            };
            ctx.db.player().identity().update(killed.clone());
            sync_player_entity(ctx, &killed);
            insert_system_message(ctx, &format!("Killed {}", target_name));
            Ok(())
        }

        "/heal" => {
            if parts.len() == 1 {
                let player = ctx
                    .db
                    .player()
                    .identity()
                    .find(sender)
                    .ok_or("Not registered")?;
                let healed = Player {
                    health: max_health(),
                    ..player
                };
                ctx.db.player().identity().update(healed.clone());
                sync_player_entity(ctx, &healed);
                insert_system_message(ctx, "Healed yourself");
            } else if parts.len() == 2 {
                let target =
                    find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
                let target_name = target.username.clone();
                let healed = Player {
                    health: target.max_health,
                    ..target
                };
                ctx.db.player().identity().update(healed.clone());
                sync_player_entity(ctx, &healed);
                insert_system_message(ctx, &format!("Healed {}", target_name));
            } else {
                insert_command_help(ctx, "Usage: /heal [player]");
                return Ok(());
            }
            Ok(())
        }

        "/god" => {
            let player = ctx
                .db
                .player()
                .identity()
                .find(sender)
                .ok_or("Not registered")?;
            let is_god = player.max_health >= god_mode_health();
            if is_god {
                let toggled = Player {
                    health: max_health(),
                    max_health: max_health(),
                    ..player
                };
                ctx.db.player().identity().update(toggled.clone());
                sync_player_entity(ctx, &toggled);
                insert_system_message(ctx, "God mode OFF");
            } else {
                let toggled = Player {
                    health: god_mode_health(),
                    max_health: god_mode_health(),
                    ..player
                };
                ctx.db.player().identity().update(toggled.clone());
                sync_player_entity(ctx, &toggled);
                insert_system_message(ctx, "God mode ON");
            }
            Ok(())
        }

        "/ammo" => {
            crate::weapons::set_all_ammo_value(ctx, sender, 999);
            insert_system_message(ctx, "Infinite ammo granted");
            Ok(())
        }

        "/weather" => {
            if parts.len() != 2 {
                insert_command_help(
                    ctx,
                    "Usage: /weather <0-4> (0=Clear 1=Cloudy 2=Overcast 3=Rainy 4=Stormy)",
                );
                return Ok(());
            }
            let w: u8 = parts[1]
                .parse()
                .map_err(|_| "Invalid weather type".to_string())?;
            if w >= NUM_WEATHER_TYPES {
                return Err(format!("Weather must be 0-{}", NUM_WEATHER_TYPES - 1));
            }
            if let Some(env) = ctx.db.world_environment().id().find(1) {
                let preset = &weather_presets()[w as usize];
                ctx.db.world_environment().id().update(WorldEnvironment {
                    weather: w,
                    cloud_density: preset.cloud_density,
                    fog_density: preset.fog_density,
                    wind_speed: preset.wind_speed,
                    last_weather_change: ctx.timestamp,
                    ..env
                });
                insert_system_message(ctx, &format!("Weather set to {}", preset.name));
            }
            Ok(())
        }

        "/time" => {
            if parts.len() != 2 {
                insert_command_help(ctx, "Usage: /time <0-24>");
                return Ok(());
            }
            let t: f32 = parts[1].parse().map_err(|_| "Invalid time".to_string())?;
            if !(0.0..=24.0).contains(&t) {
                return Err("Time must be 0.0 - 24.0".to_string());
            }
            if let Some(env) = ctx.db.world_environment().id().find(1) {
                ctx.db.world_environment().id().update(WorldEnvironment {
                    time_of_day: t,
                    ..env
                });
                let hours = t as u32;
                let mins = ((t - hours as f32) * 60.0) as u32;
                insert_system_message(ctx, &format!("Time set to {:02}:{:02}", hours, mins));
            }
            Ok(())
        }

        "/announce" => {
            if parts.len() < 2 {
                insert_command_help(ctx, "Usage: /announce <message>");
                return Ok(());
            }
            let msg = parts[1..].join(" ");
            insert_system_message(ctx, &format!("[ANNOUNCEMENT] {}", msg));
            Ok(())
        }

        "/killall" => {
            let target_ids: Vec<Identity> = ctx
                .db
                .player()
                .iter()
                .filter(|p| p.online && p.identity != sender)
                .map(|p| p.identity)
                .collect();
            let count = target_ids.len();
            for id in target_ids {
                if let Some(target) = ctx.db.player().identity().find(id) {
                    let target = dismount_player_internal(ctx, target, true);
                    let killed = Player {
                        health: 0,
                        deaths: target.deaths + 1,
                        last_damage_time: ctx.timestamp,
                        ..target
                    };
                    ctx.db.player().identity().update(killed.clone());
                    sync_player_entity(ctx, &killed);
                }
            }
            insert_system_message(ctx, &format!("Killed {} players", count));
            Ok(())
        }

        "/respawnall" => {
            let target_ids: Vec<Identity> = ctx
                .db
                .player()
                .iter()
                .filter(|p| p.online && p.identity != sender)
                .map(|p| p.identity)
                .collect();
            let count = target_ids.len();
            for id in target_ids {
                if let Some(target) = ctx.db.player().identity().find(id) {
                    let target = dismount_player_internal(ctx, target, true);
                    let respawned = Player {
                        health: max_health(),
                        pos: SPAWN_POS,
                        vel: ZERO_VEL,
                        spawn_protected: true,
                        ..target
                    };
                    ctx.db.player().identity().update(respawned.clone());
                    sync_player_entity(ctx, &respawned);
                    init_movement_state(ctx, id, &SPAWN_POS);
                }
            }
            insert_system_message(ctx, &format!("Respawned {} players", count));
            Ok(())
        }

        "/fly" => {
            insert_system_message(ctx, "Fly mode toggled");
            Ok(())
        }
        "/" | "/help" => {
            insert_admin_help(ctx);
            Ok(())
        }
        _ => {
            insert_command_help(ctx, &format!("Unknown command: {}", parts[0]));
            Ok(())
        }
    }
}
