#!/usr/bin/env bash
# Launch headless PPO navigation training (no GUI) on this CPU box, detached.
#
# Usage:
#   training/scripts/run-headless-training.sh [extra train args...]
#
# Builds the release `train` binary, then launches it under nohup writing logs to
# the checkpoint dir. Prints the PID. Tail progress with:
#   tail -f training/src-tauri/checkpoints/run.log
#   tail -f training/src-tauri/checkpoints/progress.jsonl
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CRATE_DIR="$REPO_ROOT/training/src-tauri"
CKPT_DIR="${CKPT_DIR:-$CRATE_DIR/checkpoints}"
EXPORT_PATH="${EXPORT_PATH:-$REPO_ROOT/bots/model/navigation.safetensors}"

# shellcheck disable=SC1090
source "$HOME/.cargo/env"

echo "[run] building release train binary..."
( cd "$CRATE_DIR" && cargo build --release --no-default-features --bin train )

mkdir -p "$CKPT_DIR"
BIN="$CRATE_DIR/target/release/train"

echo "[run] launching detached trainer (ckpt=$CKPT_DIR export=$EXPORT_PATH)"
nohup "$BIN" \
  --checkpoint-dir "$CKPT_DIR" \
  --export "$EXPORT_PATH" \
  "$@" \
  > "$CKPT_DIR/run.log" 2>&1 &

PID=$!
echo "$PID" > "$CKPT_DIR/train.pid"
echo "[run] training PID $PID (saved to $CKPT_DIR/train.pid)"
echo "[run] logs: $CKPT_DIR/run.log   progress: $CKPT_DIR/progress.jsonl"
