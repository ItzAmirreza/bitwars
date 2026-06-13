//! Deterministic evaluation CLI for trained navigation checkpoints.
//!
//! Build:  cargo build --release --no-default-features --bin eval
//! Usage:  eval --checkpoint <best.safetensors> [--seed 777] [--episodes 300] [--envs 32] [--json]
//!
//! Runs the deterministic (deployed) policy across every curriculum task on a
//! held-out seed and prints per-task success/stall/timeout, plus an overall mean
//! success rate (the deploy gate).

use bitwars_training::eval::evaluate_checkpoint;

fn main() {
    let mut checkpoint: Option<String> = None;
    let mut seed: u64 = 777;
    let mut episodes: usize = 300;
    let mut envs: usize = 32;
    let mut json = false;

    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < raw.len() {
        let (key, inline) = match raw[i].split_once('=') {
            Some((k, v)) => (k.to_string(), Some(v.to_string())),
            None => (raw[i].clone(), None),
        };
        let val = |i: &mut usize| -> String {
            if let Some(v) = &inline {
                v.clone()
            } else {
                *i += 1;
                raw.get(*i).cloned().unwrap_or_default()
            }
        };
        match key.as_str() {
            "--checkpoint" | "-c" => checkpoint = Some(val(&mut i)),
            "--seed" => seed = val(&mut i).parse().unwrap_or(seed),
            "--episodes" => episodes = val(&mut i).parse().unwrap_or(episodes),
            "--envs" => envs = val(&mut i).parse().unwrap_or(envs),
            "--json" => json = true,
            "-h" | "--help" => {
                eprintln!("usage: eval --checkpoint <file> [--seed N] [--episodes N] [--envs N] [--json]");
                std::process::exit(0);
            }
            other => {
                eprintln!("unknown arg: {other}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    let checkpoint = checkpoint.unwrap_or_else(|| {
        eprintln!("error: --checkpoint is required");
        std::process::exit(2);
    });

    eprintln!(
        "[eval] checkpoint={checkpoint} seed={seed} episodes/task={episodes} envs={envs}"
    );
    let results = match evaluate_checkpoint(&checkpoint, seed, episodes, envs) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[eval] error: {e}");
            std::process::exit(1);
        }
    };

    if json {
        println!("{}", serde_json::to_string(&results).unwrap_or_default());
        return;
    }

    println!(
        "\n{:<14} {:>4}  {:>8}  {:>8}  {:>8}  {:>9}  {:>7}",
        "task", "eps", "success", "stall", "timeout", "reward", "len"
    );
    println!("{}", "-".repeat(70));
    let mut succ_sum = 0.0f32;
    for r in &results {
        println!(
            "{:<14} {:>4} {:>7.1}% {:>7.1}% {:>7.1}% {:>9.1} {:>7.1}",
            r.task,
            r.episodes,
            r.success_rate * 100.0,
            r.stall_rate * 100.0,
            r.timeout_rate * 100.0,
            r.mean_reward,
            r.mean_len,
        );
        succ_sum += r.success_rate;
    }
    let overall = if results.is_empty() {
        0.0
    } else {
        succ_sum / results.len() as f32
    };
    println!("{}", "-".repeat(70));
    println!("overall mean success: {:.1}%", overall * 100.0);
}
