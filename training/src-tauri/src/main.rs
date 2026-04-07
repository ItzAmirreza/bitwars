#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod rl;
mod sim;
mod training_loop;
#[allow(dead_code, unused_imports)]
mod worldgen;

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

    let shared_state: bridge::SharedState =
        std::sync::Arc::new(std::sync::Mutex::new(bridge::TrainingState::default()));

    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            bridge::start_training,
            bridge::pause_training,
            bridge::resume_training,
            bridge::stop_training,
            bridge::get_training_stats,
            bridge::get_reward_history,
            bridge::list_checkpoints,
            bridge::save_checkpoint_now,
            bridge::load_checkpoint,
            bridge::get_live_bot_state,
            bridge::get_training_status,
            bridge::get_terrain_chunks,
            bridge::get_episode_replay,
            bridge::update_hyperparams,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
