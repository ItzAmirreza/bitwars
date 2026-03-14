# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BitWars is a multiplayer 3D voxel FPS built with a TypeScript/React client and a Rust/SpacetimeDB server. Players connect via WebSocket to a real-time distributed database that handles all state synchronization.

## Repository Layout

- **`client/`** — React 19 + Three.js + Zustand frontend (Vite build, use `bun`)
- **`server/spacetimedb/`** — Rust WASM module deployed to SpacetimeDB 2.0
- **`client/src/game/`** — 3D engine: rendering, physics, weapons, VFX, audio
- **`client/src/game/InterpolationBuffer.ts`** — Entity interpolation for smooth remote players
- **`client/src/screens/`** — React UI screens (Login, Lobby, Game HUD)
- **`client/src/module_bindings/`** — **Auto-generated** by `spacetime generate` — do NOT edit manually

## Build & Dev Commands

### Client
```bash
cd client
bun install
bun dev              # Vite dev server with HMR
bun run build        # Production build (also runs tsc)
bun run lint         # ESLint
```

### Server
```bash
cd server/spacetimedb
cargo build --target wasm32-unknown-unknown --release
```

### SpacetimeDB CLI (run from `server/`)
```bash
spacetime publish bitwars --module-path ./spacetimedb                          # Deploy module
spacetime publish bitwars --clear-database -y --module-path ./spacetimedb      # Clear & republish (schema changes)
spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb  # Regenerate client bindings
spacetime logs bitwars                                                         # View server logs
```

---

## MANDATORY: Deployment After Server Changes

**Every time server code is modified, you MUST complete the full deploy cycle before considering the task done:**

1. `cargo build --target wasm32-unknown-unknown --release` — verify it compiles
2. `spacetime publish bitwars --clear-database -y --module-path ./spacetimedb` — deploy (use `--clear-database` only if schema changed)
3. `spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb` — regenerate bindings
4. `bun run build` (in `client/`) — verify client compiles with new bindings

Never leave server changes unpublished or bindings out of sync. The client WILL break if bindings don't match the deployed module.

---

## Architecture Principles

### 1. Server Is the ONLY Source of Truth

Every piece of game state that affects gameplay MUST be server-authoritative. The server decides what happened — the client only renders it.

- **Health, kills, deaths, ammo** — server-owned, client reads from table updates
- **Block state (WorldChunk)** — server-owned, client applies authoritative chunk data
- **Player positions** — server validates (speed checks, bounds clamping)
- **Weapon fire rate, damage, cooldowns** — server enforces, client predicts for responsiveness

**Client-side prediction is allowed ONLY for instant visual feedback**, and MUST be reconciled when the server responds. Examples:
- Block destruction: client removes block immediately, server confirms via WorldChunk update. If server disagrees, `loadChunk()` corrects the client
- Ammo deduction: client decrements immediately, server sends corrected count via `player_weapon_state` table

### 2. Every Event Must Be Visible to All Players

When something happens in the game, ALL connected players must see it. Never fire-and-forget on the client only.

**Pattern for game events:**
1. Create a short-lived **event table** on the server (e.g., `ShotEvent`, `ExplosionEvent`, `DetachEvent`)
2. Insert a row in the reducer that causes the event
3. Client listens via `table.onInsert()` and renders VFX/audio
4. Scheduled cleanup reducer removes stale rows every few seconds
5. The originating client skips its own events (it already played local VFX)

**Currently synced events:** ShotEvent (tracers + hitscan impacts), ExplosionEvent (explosion VFX, shake, knockback), DetachEvent (structural collapse), WorldChunk updates (block changes), ChatMessage

**If you add a new gameplay effect** (new weapon, ability, environmental hazard, etc.), it MUST have a corresponding server event table so all clients see it.

### 3. Smooth Multiplayer Movement

Remote players use an **InterpolationBuffer** (`client/src/game/InterpolationBuffer.ts`) that:
- Stores position snapshots with timestamps from server updates
- Renders remote players 100ms behind real-time (interpolation delay)
- Interpolates smoothly between snapshots using time-based lerp
- Falls back to velocity-based extrapolation (capped at 200ms) when packets are late
- Handles yaw wrapping via shortest-path interpolation

**Position updates** include velocity (`vel: Vec3`) and use adaptive rate: 30Hz when active, 10Hz when idle.

**Never use raw `lerp(target, 0.3)` for network-synced positions.** Always use the interpolation buffer.

### 4. Server Validation & Anti-Cheat

Every reducer that modifies game state MUST validate inputs:
- **Range checks**: Is the action origin near the player's position?
- **Rate limiting**: Is the player firing faster than the weapon allows?
- **Resource checks**: Does the player have ammo/health to perform this action?
- **Bounds checks**: Are coordinates within the world?
- **Speed validation**: Is the player moving faster than allowed? (35 units/s max, tracked via `PlayerMovementState`)

Never trust client-reported values without validation. The client can be modified.

### 5. Event Table Lifecycle

Short-lived event tables (ShotEvent, ExplosionEvent, DetachEvent) follow this pattern:
- `#[table(accessor = name, public)]` with `#[primary_key] #[auto_inc] pub id: u64`
- Include `created_at: Timestamp` for cleanup
- **Must have a scheduled cleanup reducer** that deletes rows older than N seconds
- Cleanup is scheduled via a `#[table(scheduled(reducer_name))]` table (see `ShotCleanup`, `DetachCleanup`)
- The cleanup reducer reschedules itself after running

### 6. Client-Side Prediction with Reconciliation

For features where instant feedback matters (shooting, block breaking):
1. Apply the change locally immediately (client prediction)
2. Send the action to the server via reducer
3. Track what was predicted (e.g., `pendingBlockDestructions` map in `WeaponSystem`)
4. When server confirms via table update, clear the prediction tracking
5. If server disagrees, the authoritative table update naturally corrects the client state
6. Skip redundant VFX for already-predicted changes (avoid double particles)

---

## Feature Implementation Checklist

When implementing ANY new feature:

1. **Server first**: Define table(s) and reducer(s) in `lib.rs`
2. **Validate everything**: Reducers must check permissions, ranges, rates, resources
3. **Event broadcasting**: If the feature has visual/audio effects, create an event table so all clients see it
4. **Cleanup**: If you create an event table, add scheduled cleanup (follow `ShotCleanup` pattern)
5. **Build server**: `cargo build --target wasm32-unknown-unknown --release`
6. **Publish**: `spacetime publish bitwars [--clear-database -y] --module-path ./spacetimedb`
7. **Regenerate bindings**: `spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb`
8. **Client integration**: Subscribe to new tables, call reducers, render from table data
9. **Client prediction** (if needed): Predict locally, reconcile on server response
10. **Build client**: `bun run build` in `client/` to verify no type errors

**Common mistakes to avoid:**
- Fixing or touching pre-existing build errors/warnings that are unrelated to your current task — leave them alone
- Adding client-only effects that other players can't see
- Forgetting to publish/regenerate after server changes
- Trusting client input without server validation
- Using `lerp(pos, 0.3)` instead of the interpolation buffer for remote players
- Creating event tables without scheduled cleanup (rows accumulate forever)
- Editing files in `client/src/module_bindings/` (they get overwritten by `spacetime generate`)
- **Forgetting to add new tables to the subscription list in `client/src/db.ts`** — this project does NOT use `subscribeToAllTables()`. It uses an explicit whitelist of `SELECT * FROM <table>` queries. If you add a new server table and set up `onInsert`/`onUpdate`/`onDelete` handlers on the client, the callbacks will silently never fire unless the table is also added to the `.subscribe([...])` array in `db.ts`. Always trace the full data pipeline: server table → publish → regenerate bindings → **add to `db.ts` subscription list** → client `onInsert` handler.

---

## Game Feel & Visual Style

BitWars has a gritty, voxel-based aesthetic. When adding visual features:

- **Voxel world**: 16x16x16 chunks, RLE-compressed. Block colors defined in `VoxelWorld.ts` `BLOCK_COLORS`
- **Lighting**: Dynamic day/night cycle via `SkySystem`. Warm sun (0xffe0b0), cool moon (0x9bb4ff), hemisphere light
- **Post-processing**: Bloom, color grading, damage vignette via `PostFX`
- **VFX**: Particle-based effects (explosions, debris, tracers, impacts) via instanced meshes in `VFX.ts`. Keep particle counts reasonable (MAX_PARTICLES = 2000)
- **Audio**: Spatial audio for gunfire, explosions, footsteps, impacts via `AudioSystem.ts`
- **Screen shake**: Distance-attenuated, used for explosions and landing impacts
- **Physics debris**: Falling blocks from structural collapse, explosion knockback via `PhysicsSystem.ts` (MAX_FALLING = 500)
- **Player models**: Simple box-based (body + head + nametag sprite). Keep them lightweight

**Performance budget**: Target 60fps. Use instanced rendering for particles/debris. Limit per-frame allocations. Cap physics objects.

---

## Data Flow

1. Client subscribes to all tables on connect (`subscribeToAllTables()` in `db.ts`)
2. SpacetimeDB auto-syncs table changes to all subscribers via WebSocket
3. Client mutations go through **reducers** (server-side functions), never direct table writes
4. The game engine watches table changes via `onInsert`/`onUpdate`/`onDelete` callbacks
5. Remote player positions flow through `InterpolationBuffer` for smooth rendering

### Client State Architecture
- **Zustand store** (`client/src/store.ts`): UI state (screen, username, connection)
- **SpacetimeDB connection** (`client/src/db.ts`): real-time data subscriptions
- **Engine** (`client/src/game/Engine.ts`): orchestrates Three.js scene, all game systems, server event listeners

### Server State
- All game logic lives in `server/spacetimedb/src/lib.rs` — tables, reducers, lifecycle hooks
- Key reducers: `update_position`, `fire_weapon`, `projectile_impact`, `destroy_blocks_physics`, `respawn`, `send_chat`, `reload_weapon`
- Scheduled reducers: `tick_environment` (10s), `cleanup_detach_events` (5s), `cleanup_shots_scheduled` (3s)
- Lifecycle: `init` (world generation), `client_connected`, `client_disconnected`

---

## SpacetimeDB Rules (Critical)

The server has extensive SpacetimeDB rules in `server/CLAUDE.md` — **read it before modifying server code.** Key points:

- Use `spacetimedb` crate for server modules, NOT `spacetimedb-sdk` (that's client-only)
- Do NOT derive `SpacetimeType` on `#[table]` structs — the macro handles it
- Access tables via method: `ctx.db.table()` not field `ctx.db.table`
- Reducers take `&ReducerContext` (immutable), must be deterministic (no fs/network/timers)
- Reducers return `()` or `Result<(), String>` — they cannot return data
- Use `ctx.timestamp` and `ctx.rng` instead of `std::time` and `rand`
- `use spacetimedb::Table` is required for `.insert()`, `.iter()`, etc.
- Update pattern: find existing row, spread with `..existing`, override fields

---

## Environment

- Database name: `bitwars` (on maincloud)
- Dashboard: https://spacetimedb.com/bitwars
- Client connects to `wss://maincloud.spacetimedb.com` (configurable via `VITE_SPACETIMEDB_URI`)
- Module name configurable via `VITE_MODULE_NAME` (defaults to `bitwars`)
- Server `spacetime.json` + `spacetime.local.json`: deployment config
- Package manager: **bun** (not npm)
