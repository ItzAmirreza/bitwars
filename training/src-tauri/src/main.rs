#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Tauri desktop GUI entrypoint. Only built with the `gui` feature; the headless
//! trainer lives in `src/bin/train.rs`. All logic lives in the `bitwars_training`
//! library crate.

use bitwars_training::bridge;
use bitwars_training::state::{SharedState, TrainingState};

fn main() {
    // Workaround for WebKitGTK rendering issues on Wayland + AMD GPU.
    // Disable DMA-BUF renderer to avoid "Failed to create GBM buffer" errors,
    // and force X11 backend to avoid Wayland protocol errors.
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if std::env::var("GDK_BACKEND").is_err() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    env_logger::init();

    let shared_state: SharedState =
        std::sync::Arc::new(std::sync::Mutex::new(TrainingState::default()));

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            bridge::start_training,
            bridge::pause_training,
            bridge::resume_training,
            bridge::stop_training,
            bridge::get_training_stats,
            bridge::get_training_config,
            bridge::get_reward_history,
            bridge::list_checkpoints,
            bridge::delete_checkpoint,
            bridge::clear_checkpoints,
            bridge::save_checkpoint_now,
            bridge::load_checkpoint,
            bridge::get_live_bot_state,
            bridge::get_preview_frame,
            bridge::get_training_status,
            bridge::set_preview_bot,
            bridge::set_preview_mode,
            bridge::get_terrain_chunks,
            bridge::get_episode_list,
            bridge::get_episode_replay,
            bridge::delete_replay,
            bridge::clear_replays,
            bridge::update_hyperparams,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
