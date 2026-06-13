//! Headless PPO navigation trainer — runs the training loop without the Tauri GUI.
//!
//! Build (CPU-only, no tauri/webkit):
//!     cargo build --release --no-default-features --bin train
//!
//! Run (example):
//!     ./target/release/train --envs 16 --seed 42 \
//!         --checkpoint-dir ./checkpoints \
//!         --export ../../bots/model/navigation.safetensors \
//!         --max-minutes 600 --log-secs 30
//!
//! Writes rotating checkpoints + a `best.safetensors` into --checkpoint-dir, and
//! appends one JSON stats line per --log-secs to `<checkpoint-dir>/progress.jsonl`.
//! On exit (SIGINT, --max-episodes, or --max-minutes) it saves a final checkpoint
//! and, if --export is given, copies `best.safetensors` to that path so the bots
//! pick up the freshly trained navigation model.

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bitwars_training::state::{HyperParams, RuntimeTrainingConfig, SharedState, TrainingState};
use bitwars_training::training_loop::run_training;

struct Args {
    num_envs: Option<usize>,
    seed: Option<u64>,
    max_episodes: Option<u64>,
    max_minutes: Option<f64>,
    checkpoint_dir: PathBuf,
    export: Option<PathBuf>,
    lr: Option<f64>,
    gamma: Option<f32>,
    entropy: Option<f32>,
    rollout: Option<usize>,
    log_secs: f64,
}

impl Default for Args {
    fn default() -> Self {
        Args {
            num_envs: None,
            seed: None,
            max_episodes: None,
            max_minutes: None,
            checkpoint_dir: PathBuf::from("checkpoints"),
            export: None,
            lr: None,
            gamma: None,
            entropy: None,
            rollout: None,
            log_secs: 30.0,
        }
    }
}

const USAGE: &str = "\
bitwars headless trainer

USAGE:
    train [OPTIONS]

OPTIONS:
    --envs <N>              Number of parallel environments (default: auto by CPU)
    --seed <N>              World/RNG seed (default: 42)
    --max-episodes <N>      Stop after this many completed episodes (default: unbounded)
    --max-minutes <F>       Stop after this many wall-clock minutes (default: unbounded)
    --checkpoint-dir <DIR>  Where to write checkpoints + progress.jsonl (default: ./checkpoints)
    --export <FILE>         On exit, copy best.safetensors here (e.g. the bots' nav model)
    --lr <F>                Override learning rate
    --gamma <F>             Override discount gamma
    --entropy <F>           Override entropy coefficient
    --rollout <N>           Override rollout length
    --log-secs <F>          Seconds between progress log lines (default: 30)
    -h, --help              Print this help
";

fn parse_args() -> Result<Args, String> {
    let mut args = Args::default();
    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < raw.len() {
        let arg = &raw[i];
        // Support both "--key value" and "--key=value".
        let (key, inline_val) = match arg.split_once('=') {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (arg.clone(), None),
        };
        let take_val = |i: &mut usize| -> Result<String, String> {
            if let Some(v) = &inline_val {
                Ok(v.clone())
            } else {
                *i += 1;
                raw.get(*i)
                    .cloned()
                    .ok_or_else(|| format!("missing value for {}", key))
            }
        };
        match key.as_str() {
            "-h" | "--help" => {
                print!("{}", USAGE);
                std::process::exit(0);
            }
            "--envs" => args.num_envs = Some(take_val(&mut i)?.parse().map_err(|e| format!("--envs: {e}"))?),
            "--seed" => args.seed = Some(take_val(&mut i)?.parse().map_err(|e| format!("--seed: {e}"))?),
            "--max-episodes" => {
                args.max_episodes = Some(take_val(&mut i)?.parse().map_err(|e| format!("--max-episodes: {e}"))?)
            }
            "--max-minutes" => {
                args.max_minutes = Some(take_val(&mut i)?.parse().map_err(|e| format!("--max-minutes: {e}"))?)
            }
            "--checkpoint-dir" => args.checkpoint_dir = PathBuf::from(take_val(&mut i)?),
            "--export" => args.export = Some(PathBuf::from(take_val(&mut i)?)),
            "--lr" => args.lr = Some(take_val(&mut i)?.parse().map_err(|e| format!("--lr: {e}"))?),
            "--gamma" => args.gamma = Some(take_val(&mut i)?.parse().map_err(|e| format!("--gamma: {e}"))?),
            "--entropy" => args.entropy = Some(take_val(&mut i)?.parse().map_err(|e| format!("--entropy: {e}"))?),
            "--rollout" => args.rollout = Some(take_val(&mut i)?.parse().map_err(|e| format!("--rollout: {e}"))?),
            "--log-secs" => args.log_secs = take_val(&mut i)?.parse().map_err(|e| format!("--log-secs: {e}"))?,
            other => return Err(format!("unknown argument: {}", other)),
        }
        i += 1;
    }
    Ok(args)
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("error: {e}\n\n{USAGE}");
            std::process::exit(2);
        }
    };

    // Build the runtime config from CPU-aware defaults, then apply CLI overrides.
    let mut cfg = RuntimeTrainingConfig::recommended();
    if let Some(seed) = args.seed {
        cfg.seed = seed;
    }
    let overrides = HyperParams {
        lr: args.lr,
        gamma: args.gamma,
        entropy_coeff: args.entropy,
        num_envs: args.num_envs,
        rollout_length: args.rollout,
    };
    cfg.apply_params(&overrides);

    std::fs::create_dir_all(&args.checkpoint_dir).ok();
    let progress_file = args.checkpoint_dir.join("progress.jsonl");

    eprintln!(
        "[train] starting: envs={} seed={} rollout={} minibatch={} lr={:.2e} gamma={:.4} entropy={:.4}",
        cfg.num_envs,
        cfg.seed,
        cfg.ppo.rollout_length,
        cfg.ppo.minibatch_size,
        cfg.ppo.lr,
        cfg.ppo.gamma,
        cfg.ppo.entropy_coeff,
    );
    eprintln!(
        "[train] checkpoint-dir={} export={} max-episodes={} max-minutes={}",
        args.checkpoint_dir.display(),
        args.export.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "(none)".into()),
        args.max_episodes.map(|n| n.to_string()).unwrap_or_else(|| "∞".into()),
        args.max_minutes.map(|n| n.to_string()).unwrap_or_else(|| "∞".into()),
    );

    // Build shared state with training already marked running.
    let state: SharedState = Arc::new(Mutex::new(TrainingState {
        is_running: true,
        runtime_config: cfg.clone(),
        checkpoint_dir: args.checkpoint_dir.clone(),
        ..Default::default()
    }));

    // SIGINT → graceful stop (run_training saves a final checkpoint when is_running clears).
    {
        let stop_state = state.clone();
        if let Err(e) = ctrlc::set_handler(move || {
            eprintln!("\n[train] SIGINT — requesting graceful stop (final checkpoint will be saved)...");
            if let Ok(mut s) = stop_state.lock() {
                s.is_running = false;
            }
        }) {
            eprintln!("[train] warning: could not install SIGINT handler: {e}");
        }
    }

    // Spawn the training loop on its own thread.
    let train_state = state.clone();
    let ppo = cfg.ppo.clone();
    let num_envs = cfg.num_envs;
    let seed = cfg.seed;
    let handle = std::thread::Builder::new()
        .name("training-loop".into())
        .spawn(move || run_training(train_state, ppo, num_envs, seed))
        .expect("failed to spawn training thread");

    // Monitor loop: enforce stop conditions, emit JSONL progress.
    let start = Instant::now();
    let mut last_log = Instant::now()
        .checked_sub(Duration::from_secs(3600))
        .unwrap_or_else(Instant::now);
    let mut stop_reason = "training thread exited";

    loop {
        if handle.is_finished() {
            break;
        }
        std::thread::sleep(Duration::from_millis(500));

        // Stop conditions.
        let episode = {
            let s = state.lock().unwrap();
            s.stats.episode
        };
        if let Some(max_ep) = args.max_episodes {
            if episode >= max_ep {
                stop_reason = "reached --max-episodes";
                state.lock().unwrap().is_running = false;
            }
        }
        if let Some(max_min) = args.max_minutes {
            if start.elapsed().as_secs_f64() >= max_min * 60.0 {
                stop_reason = "reached --max-minutes";
                state.lock().unwrap().is_running = false;
            }
        }

        // Periodic progress log.
        if last_log.elapsed().as_secs_f64() >= args.log_secs {
            last_log = Instant::now();
            let stats = state.lock().unwrap().stats.clone();
            if let Ok(line) = serde_json::to_string(&stats) {
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&progress_file)
                {
                    let _ = writeln!(f, "{}", line);
                }
            }
            eprintln!(
                "[train] ep={} steps={} task={:<12} reward={:>7.1} succ={:>3.0}% stall={:>3.0}% timeout={:>3.0}% sps={:>5.0} ent={:.3} kl={:.4} ev={:.2}",
                stats.episode,
                stats.total_steps,
                stats.current_task,
                stats.mean_reward,
                stats.success_rate * 100.0,
                stats.stall_rate * 100.0,
                stats.timeout_rate * 100.0,
                stats.steps_per_sec,
                stats.entropy,
                stats.approx_kl,
                stats.explained_variance,
            );
        }
    }

    let _ = handle.join();
    eprintln!("[train] stopped ({stop_reason}). elapsed={:.1}min", start.elapsed().as_secs_f64() / 60.0);

    // Export the best model so the bots pick it up.
    if let Some(export) = &args.export {
        let best = args.checkpoint_dir.join("best.safetensors");
        if best.exists() {
            if let Some(parent) = export.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            match std::fs::copy(&best, export) {
                Ok(_) => eprintln!("[train] exported {} -> {}", best.display(), export.display()),
                Err(e) => eprintln!("[train] export failed: {e}"),
            }
        } else {
            eprintln!("[train] no best.safetensors found in {} — nothing to export", args.checkpoint_dir.display());
        }
    }

    let final_stats = state.lock().unwrap().stats.clone();
    eprintln!(
        "[train] final: episodes={} steps={} task={} mean_reward={:.1} success={:.0}%",
        final_stats.episode,
        final_stats.total_steps,
        final_stats.current_task,
        final_stats.mean_reward,
        final_stats.success_rate * 100.0,
    );
}
