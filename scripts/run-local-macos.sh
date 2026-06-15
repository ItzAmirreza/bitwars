#!/usr/bin/env bash
# =============================================================================
# BitWars — run the full local dev stack on macOS.
#
#   ./scripts/run-local-macos.sh
#
# Brings up everything with one command:
#   1. starts a local SpacetimeDB instance on a free port (prefers 3000),
#   2. publishes the game module to it,
#   3. regenerates the TypeScript client bindings,
#   4. runs the Vite client (pointed at your local instance, on a free port).
#
# Press Ctrl+C once to stop BOTH the server and the client.
#
# Your client/.env.local is NOT touched — the local URL + module name are
# injected as environment variables, which Vite prioritizes over .env files.
#
# Written for the stock macOS bash (3.2): no associative arrays / `${x,,}` etc.
# Missing tools? Install with Homebrew:
#   brew install bun                         # https://bun.sh
#   curl -sSf https://install.spacetimedb.com | sh   # SpacetimeDB CLI
#   Rust: https://rustup.rs (then `rustup target add wasm32-unknown-unknown`)
# =============================================================================
set -euo pipefail

# --- locate the repo (this script lives in <repo>/scripts) -------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server/spacetimedb"
CLIENT_DIR="$REPO_ROOT/client"
BINDINGS_DIR="$CLIENT_DIR/src/module_bindings"

MODULE="bitwars-local"
SERVER_LOG="${TMPDIR:-/tmp}/bitwars-stdb-$$.log"
SERVER_PID=""
CLEANED=0

c_cyan=$'\033[36m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
say()  { printf '%s[bitwars]%s %s\n' "$c_cyan"   "$c_off" "$*"; }
warn() { printf '%s[bitwars]%s %s\n' "$c_yellow" "$c_off" "$*" >&2; }
die()  { printf '%s[bitwars] %s%s\n' "$c_red" "$*" "$c_off" >&2; exit 1; }

cleanup() {
  [ "$CLEANED" = 1 ] && return 0
  CLEANED=1
  printf '\n'
  say "shutting down..."
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    pkill -TERM -P "$SERVER_PID" 2>/dev/null || true
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6; do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.3; done
    pkill -KILL -P "$SERVER_PID" 2>/dev/null || true
    kill -KILL "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SERVER_LOG" 2>/dev/null || true
  say "local stack stopped."
}
trap cleanup INT TERM EXIT

# --- prerequisites -----------------------------------------------------------
command -v spacetime >/dev/null 2>&1 || die "spacetime CLI not found — install: curl -sSf https://install.spacetimedb.com | sh"
command -v bun       >/dev/null 2>&1 || die "bun not found — install: brew install bun  (or https://bun.sh)"
command -v cargo     >/dev/null 2>&1 || warn "cargo not found — 'spacetime publish' needs the Rust toolchain (https://rustup.rs)."
if command -v rustup >/dev/null 2>&1; then
  if ! rustup target list --installed 2>/dev/null | grep -q '^wasm32-unknown-unknown'; then
    say "adding wasm32-unknown-unknown target..."
    rustup target add wasm32-unknown-unknown || warn "could not add the wasm target automatically"
  fi
fi

# --- pick a free port for SpacetimeDB (prefer 3000) --------------------------
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
PORT=3000
while port_in_use "$PORT"; do
  PORT=$((PORT + 1))
  [ "$PORT" -gt 3100 ] && die "no free port found in 3000-3100"
done
HOST_URL="http://127.0.0.1:$PORT"
WS_URL="ws://127.0.0.1:$PORT"
say "SpacetimeDB port: ${c_green}${PORT}${c_off}"

# --- ensure client deps ------------------------------------------------------
if [ ! -d "$CLIENT_DIR/node_modules" ]; then
  say "installing client dependencies (bun install)..."
  (cd "$CLIENT_DIR" && bun install)
fi

# --- start the local server (logs to a temp file) ----------------------------
say "starting SpacetimeDB  ${c_dim}(logs: $SERVER_LOG)${c_off}"
spacetime start -l "127.0.0.1:$PORT" >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# --- wait until it answers --------------------------------------------------
say "waiting for the server to come up..."
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -n 25 "$SERVER_LOG" >&2 || true
    die "the server process exited during startup (see log above)"
  fi
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 2 -o /dev/null "$HOST_URL/v1/ping" 2>/dev/null && { ready=1; break; }
  elif port_in_use "$PORT"; then
    sleep 1; ready=1; break
  fi
  sleep 0.5
done
[ "$ready" = 1 ] || { tail -n 25 "$SERVER_LOG" >&2 || true; die "server did not become ready in time"; }
say "server ready ${c_green}OK${c_off}"

# --- publish the module + regenerate bindings --------------------------------
say "publishing module ${c_green}${MODULE}${c_off} (first run compiles the wasm — this can take a while)..."
spacetime publish "$MODULE" -s "$HOST_URL" -p "$SERVER_DIR" --delete-data=on-conflict --break-clients -y \
  || die "publish failed (see output above)"
say "regenerating client bindings..."
spacetime generate --lang typescript --out-dir "$BINDINGS_DIR" -p "$SERVER_DIR" -y \
  || die "binding generation failed (see output above)"

# --- run the client in the foreground; Ctrl+C ends it and triggers cleanup ---
say "starting the client — Vite will print its URL below."
say "${c_dim}open that URL in your browser. Press Ctrl+C here to stop the whole stack.${c_off}"
export VITE_SPACETIMEDB_URI="$WS_URL"
export VITE_MODULE_NAME="$MODULE"
cd "$CLIENT_DIR"
bun dev || true
# bun dev returned (Ctrl+C or exit) -> EXIT trap stops the server.
