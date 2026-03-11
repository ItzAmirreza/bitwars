# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BitWars is a multiplayer 3D voxel FPS built with a TypeScript/React client and a Rust/SpacetimeDB server. Players connect via WebSocket to a real-time distributed database that handles all state synchronization.

## Repository Layout

- **`client/`** — React 19 + Three.js + Zustand frontend (Vite build)
- **`server/spacetimedb/`** — Rust WASM module deployed to SpacetimeDB 2.0
- **`client/src/game/`** — 3D engine: rendering, physics, weapons, VFX, audio
- **`client/src/screens/`** — React UI screens (Login, Lobby, Game HUD)
- **`client/src/module_bindings/`** — **Auto-generated** by `spacetime generate` — do NOT edit manually

## Build & Dev Commands

### Client
```bash
cd client
npm install
npm run dev          # Vite dev server with HMR
npm run build        # Production build
npm run lint         # ESLint
```

### Server
```bash
cd server/spacetimedb
cargo build --target wasm32-unknown-unknown --release
```

### SpacetimeDB CLI
```bash
spacetime start                                    # Local dev server
spacetime publish <db-name> --module-path ./spacetimedb  # Deploy module
spacetime publish <db-name> --clear-database -y --module-path ./spacetimedb  # Clear & republish
spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb  # Regenerate client bindings
spacetime logs <db-name>                           # View server logs
```

## Architecture

### Data Flow
1. Client subscribes to all tables on connect (Player, DestroyedBlock, ShotEvent, ChatMessage)
2. SpacetimeDB auto-syncs table changes to all subscribers via WebSocket
3. Client mutations go through **reducers** (server-side functions), never direct table writes
4. The game engine watches table changes to trigger rendering (tracers, explosions, block updates)

### Client State
- **Zustand store** (`client/src/store.ts`): UI state (screen, username, connection)
- **SpacetimeDB connection** (`client/src/db.ts`): real-time data subscriptions
- **Engine** (`client/src/game/Engine.ts`): orchestrates Three.js scene, physics, weapons, VFX

### Server State
- All game logic lives in `server/spacetimedb/src/lib.rs` — tables, reducers, and lifecycle hooks
- Reducers: `set_username`, `update_position`, `fire_weapon`, `destroy_block(s)`, `hit_player`, `respawn`, `send_chat`, `cleanup_shots`
- Lifecycle: `init`, `client_connected`, `client_disconnected`

## SpacetimeDB Rules (Critical)

The server has extensive SpacetimeDB rules in `server/CLAUDE.md` — **read it before modifying server code.** Key points:

- Use `spacetimedb` crate for server modules, NOT `spacetimedb-sdk` (that's client-only)
- Do NOT derive `SpacetimeType` on `#[table]` structs — the macro handles it
- Access tables via method: `ctx.db.table()` not field `ctx.db.table`
- Reducers take `&ReducerContext` (immutable), must be deterministic (no fs/network/timers)
- Reducers return `()` or `Result<(), String>` — they cannot return data
- Use `ctx.timestamp` and `ctx.rng` instead of `std::time` and `rand`
- `use spacetimedb::Table` is required for `.insert()`, `.iter()`, etc.

### Feature Implementation Pattern
1. Define table(s) in `lib.rs`
2. Define reducer(s) in `lib.rs`
3. Regenerate client bindings (`spacetime generate`)
4. Subscribe to table(s) in client
5. Call reducer(s) from UI — don't forget this step

## Environment

- Client `.env`: `VITE_SPACETIMEDB_URI` and `VITE_MODULE_NAME` for connection config
- Server `spacetime.json`: deployment target (maincloud by default)
- Default deployment is free on SpacetimeDB maincloud
