// ── Environment System ──
// Day/night cycle, weather transitions.

use std::time::Duration;

use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

use crate::helpers::timestamp_micros;
use crate::tables::*;

// Daytime (8:00-17:00) passes slowly, the rest of the cycle fast, so roughly
// 78% of real time is broad daylight (~90 min day / ~25 min dusk-night-dawn)
const DAY_START_HOUR: f32 = 8.0;
const DAY_END_HOUR: f32 = 17.0;
const DAY_RATE_PER_TICK: f32 = 0.0167;
const NIGHT_RATE_PER_TICK: f32 = 0.1;

#[reducer]
pub fn tick_environment(ctx: &ReducerContext, _job: EnvironmentTick) {
    if let Some(env) = ctx.db.world_environment().id().find(1) {
        let is_day = env.time_of_day >= DAY_START_HOUR && env.time_of_day < DAY_END_HOUR;
        let time_advance = if is_day {
            DAY_RATE_PER_TICK
        } else {
            NIGHT_RATE_PER_TICK
        };
        let mut new_time = env.time_of_day + time_advance;
        if new_time >= 24.0 {
            new_time -= 24.0;
        }

        let seed = timestamp_micros(ctx.timestamp);
        let since_change = timestamp_micros(ctx.timestamp)
            .saturating_sub(timestamp_micros(env.last_weather_change));
        let min_weather_interval = 300_000_000u64; // 5 min

        let mut new_weather = env.weather;
        let mut new_wind = env.wind_speed;
        let mut new_cloud = env.cloud_density;
        let mut new_fog = env.fog_density;
        let mut weather_changed = false;

        if since_change > min_weather_interval {
            let roll = (seed % 100) as u8;
            if roll < 5 {
                // Transitions favor clearing up: long-run distribution is
                // ~46% Clear, ~29% Cloudy, ~14% Overcast, ~8% Rainy, ~3% Stormy
                let transition_roll = ((seed / 100) % 100) as u8;
                new_weather = match env.weather {
                    0 => {
                        if transition_roll < 40 {
                            1
                        } else {
                            0
                        }
                    }
                    1 => {
                        if transition_roll < 60 {
                            0
                        } else if transition_roll < 85 {
                            2
                        } else {
                            3
                        }
                    }
                    2 => {
                        if transition_roll < 60 {
                            1
                        } else if transition_roll < 90 {
                            3
                        } else {
                            4
                        }
                    }
                    3 => {
                        if transition_roll < 35 {
                            1
                        } else if transition_roll < 80 {
                            2
                        } else if transition_roll < 90 {
                            4
                        } else {
                            0
                        }
                    }
                    4 => {
                        if transition_roll < 60 {
                            3
                        } else if transition_roll < 90 {
                            2
                        } else {
                            1
                        }
                    }
                    _ => 0,
                };

                if new_weather != env.weather {
                    weather_changed = true;
                    let preset = &crate::constants::weather_presets()[new_weather as usize];
                    new_wind = preset.wind_speed + ((seed % 20) as f32) / 100.0;
                    new_cloud = preset.cloud_density + ((seed % 20) as f32) / 100.0;
                    new_fog = preset.fog_density;
                    log::info!(
                        "Weather changed: {} -> {} at time {:.1}h",
                        env.weather,
                        new_weather,
                        new_time
                    );
                }
            }
        }

        ctx.db.world_environment().id().update(WorldEnvironment {
            id: 1,
            time_of_day: new_time,
            weather: new_weather,
            wind_speed: new_wind,
            cloud_density: new_cloud,
            fog_density: new_fog,
            last_weather_change: if weather_changed {
                ctx.timestamp
            } else {
                env.last_weather_change
            },
        });
    }

    ctx.db.environment_tick().insert(EnvironmentTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(10)),
    });
}
