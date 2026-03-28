# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BitWars is a multiplayer 3D voxel FPS built with a TypeScript/React client and a Rust/SpacetimeDB server. Players connect via WebSocket to a real-time distributed database that handles all state synchronization.

---

## Repository Layout

```
bitwars/
├── shared/
│   └── game-constants.json        ← SINGLE SOURCE OF TRUTH for all game stats
│
├── server/spacetimedb/src/
│   ├── lib.rs                     Module declarations only
│   ├── shared_config.rs           Reads game-constants.json at compile time
│   ├── types.rs                   Vec3, Rotation, DestroyedBlock
│   ├── constants.rs               All tuning parameters (sourced from shared config)
│   ├── tables.rs                  All SpacetimeDB table schemas
│   ├── weapons/                   1 file per weapon (registry pattern)
│   │   ├── mod.rs                 WeaponDef, registry, ammo accessors, fire validation
│   │   ├── rifle.rs ... grenade_launcher.rs
│   │   └── vehicle_minigun.rs, vehicle_rockets.rs
│   ├── vehicles/                  1 file per vehicle type (dispatcher pattern)
│   │   ├── mod.rs                 tick_vehicles dispatcher
│   │   ├── helicopter.rs          Helicopter physics
│   │   ├── fighter_jet.rs         Fighter jet physics
│   │   ├── interaction.rs         Mount/dismount
│   │   ├── weapons.rs             Vehicle fire/reload
│   │   └── spawning.rs            Spawn logic
│   ├── combat/                    Damage resolution + fire reducers
│   │   ├── damage.rs              Shared hitscan/splash/kill helpers
│   │   ├── fire.rs                fire_weapon, reload_weapon
│   │   ├── projectile.rs          projectile_impact
│   │   ├── bunker_buster.rs       Bunker buster weapon logic
│   │   └── blocks.rs              destroy_blocks_physics, sync_entity_transform
│   ├── worldgen/                  Procedural generation
│   │   ├── mod.rs                 generate_chunk + RLE
│   │   ├── noise.rs, biomes.rs, roads.rs, structural.rs
│   │   └── structures/            1 file per structure type
│   ├── helpers/                   math.rs, entity_ops.rs, player_state.rs, vehicle_helpers.rs, vehicle_input.rs, terrain_cache.rs
│   ├── grenades.rs, player.rs, admin.rs, chat.rs, chunks.rs
│   ├── lifecycle.rs, environment.rs, cleanup.rs, map.rs
│   └── (56 files total)
│
├── client/src/
│   ├── shared-config.ts           Typed imports from game-constants.json
│   ├── game/
│   │   ├── Engine.ts              Orchestrator (2,981 lines — animate loop + server listeners)
│   │   ├── WeaponRegistry.ts      Single source of truth for client weapon data
│   │   ├── Weapons.ts             Weapon fire logic (raycasting, spread, recoil)
│   │   ├── vehicles/
│   │   │   ├── VehicleBase.ts     Abstract VehicleType interface
│   │   │   ├── VehicleManager.ts  Universal vehicle manager with type registry
│   │   │   ├── VehiclePhysics.ts  Vehicle physics simulation
│   │   │   ├── HelicopterType.ts  Helicopter model + animation + breakup
│   │   │   └── FighterJetType.ts  Fighter jet model + animation + breakup
│   │   ├── audio/                 Ray-traced procedural audio system
│   │   │   ├── AudioCore.ts       Submix buses, dynamic reverb, spatial bus, voice mgmt
│   │   │   ├── AudioRayTracer.worker.ts  Web Worker: DDA voxel raycasting for acoustics
│   │   │   ├── AudioRayState.ts   Main-thread store for ray-traced environment + propagation
│   │   │   ├── NoisePool.ts       Pre-allocated noise buffer pool (round-robin reuse)
│   │   │   ├── VoiceManager.ts    Polyphony limiter, distance culling, voice stealing
│   │   │   ├── WeaponAudio.ts, CombatAudio.ts, MovementAudio.ts
│   │   │   ├── UIAudio.ts, VehicleAudio.ts, AmbientAudio.ts
│   │   │   └── (AudioSystem.ts is the facade + worker lifecycle)
│   │   ├── ChunkStreamer.ts       Chunk loading/streaming/bootstrap
│   │   ├── LanternSystem.ts       Lantern lights + glow sprites
│   │   ├── RemotePlayerManager.ts Remote player models + interpolation
│   │   ├── InfantryFireController.ts  Infantry fire pipeline + server sync
│   │   ├── VehicleFireController.ts   Vehicle fire pipeline + server sync
│   │   ├── VoxelWorld.ts, PhysicsSystem.ts, FPSControls.ts
│   │   ├── SkySystem.ts, ProjectileManager.ts, VFX.ts
│   │   ├── WeaponModel.ts, PostFX.ts, InterpolationBuffer.ts
│   │   └── (45 files total)
│   ├── screens/
│   │   ├── GameScreen.tsx         Slim orchestrator (769 lines)
│   │   ├── LobbyScreen.tsx        Lobby / match browser
│   │   ├── LoginScreen.tsx        Login flow
│   │   ├── PerfPanel.tsx          Performance debug overlay
│   │   ├── SettingsPanel.tsx      Settings UI
│   │   ├── hud/                   8 extracted HUD components
│   │   │   ├── BottomHud.tsx, TopHudBar.tsx, LoadoutOverlay.tsx
│   │   │   ├── Crosshair.tsx, KillFeed.tsx, ChatOverlay.tsx, DeathScreen.tsx
│   │   │   └── BunkerBusterDepthView.tsx
│   │   └── hooks/                 useKillTracking.ts, useChat.ts
│   ├── store.ts, db.ts, App.tsx
│   └── module_bindings/           Auto-generated — do NOT edit
```

---

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

### 1. Shared Constants — Single Source of Truth

**`shared/game-constants.json`** is the canonical source for ALL gameplay values shared between client and server:
- Weapon stats (damage, fire rate, ammo, range)
- Vehicle stats (health, speed, hitbox)
- Block types and world dimensions
- Entity kinds and vehicle types
- Combat validation thresholds
- Weather presets

**Server** reads it at compile time via `include_str!` + `serde_json` in `shared_config.rs`.
**Client** imports it via `shared-config.ts` using Vite's JSON import.

**CRITICAL**: When changing any gameplay value, edit `game-constants.json` FIRST, then verify both sides still build. Never hardcode a value that exists in the shared config.

### 2. Registry Pattern — How to Add New Content

The codebase uses registry patterns so new content (weapons, vehicles, structures, biomes) is added by creating new files, not editing existing ones.

#### Adding a New Weapon
1. Add entry to `shared/game-constants.json` → `weapons` array
2. **Server**: Create `server/weapons/my_weapon.rs` (optional — only if it has special behavior like grenade bouncing). Add `pub mod` to `weapons/mod.rs`. The registry auto-reads from JSON.
3. **Client**: Add client-only rendering data to `WeaponRegistry.ts` (recoil, projectile VFX config, HUD description). The stats come from shared config automatically.
4. Add audio to `client/audio/WeaponAudio.ts`
5. Add first-person model to `client/WeaponModel.ts`
6. Add SVG silhouette to `client/screens/hud/LoadoutOverlay.tsx`

#### Adding a New Vehicle
1. Add type ID to `shared/game-constants.json` → `vehicleTypes` + stats section
2. **Server**: Create `server/vehicles/tank.rs` with physics tick. Add match arm in `vehicles/mod.rs` dispatcher. Add spawn logic in `vehicles/spawning.rs`.
3. **Client**: Create `client/game/vehicles/TankType.ts` implementing `VehicleType` interface (model, animation, breakup). Register it in `VehicleManager` constructor.
4. Add audio to `client/audio/VehicleAudio.ts`

#### Adding a New Structure
1. Create `server/worldgen/structures/my_structure.rs`
2. Add `pub mod my_structure;` to `structures/mod.rs`
3. Add match arm in `place_structure_in_chunk`
4. Add biome placement probability in `place_biome_structures`

#### Adding a New Biome
1. Add variant to `Biome` enum in `worldgen/biomes.rs`
2. Implement `biome_height`, `biome_surface_block`, `biome_subsurface_block`, `biome_deep_block`
3. Add to `get_biome` hash mapping

### 3. Server Is the ONLY Source of Truth

Every piece of game state that affects gameplay MUST be server-authoritative. The server decides what happened — the client only renders it.

- **Health, kills, deaths, ammo** — server-owned, client reads from table updates
- **Block state (WorldChunk)** — server-owned, client applies authoritative chunk data
- **Player positions** — server validates (speed checks, bounds clamping)
- **Weapon fire rate, damage, cooldowns** — server enforces, client predicts for responsiveness

**Client-side prediction is allowed ONLY for instant visual feedback**, and MUST be reconciled when the server responds. Examples:
- Block destruction: client removes block immediately, server confirms via WorldChunk update
- Ammo deduction: client decrements immediately, server sends corrected count via `PlayerAmmo` table

### 4. Every Event Must Be Visible to All Players

When something happens in the game, ALL connected players must see it. Never fire-and-forget on the client only.

**Pattern for game events:**
1. Create a short-lived **event table** on the server (e.g., `ShotEvent`, `ExplosionEvent`, `DetachEvent`)
2. Insert a row in the reducer that causes the event
3. Client listens via `table.onInsert()` and renders VFX/audio
4. Scheduled cleanup reducer removes stale rows every few seconds
5. The originating client skips its own events (it already played local VFX)

**If you add a new gameplay effect** (new weapon, ability, environmental hazard, etc.), it MUST have a corresponding server event table so all clients see it.

### 5. Smooth Multiplayer Movement

Remote players and vehicles use an **InterpolationBuffer** that:
- Stores position snapshots with timestamps from server updates
- Renders remote entities 100ms behind real-time (interpolation delay)
- Interpolates smoothly between snapshots using time-based lerp
- Falls back to velocity-based extrapolation (capped at 200ms) when packets are late

**Never use raw `lerp(target, 0.3)` for network-synced positions.** Always use the interpolation buffer.

### 6. Server Validation & Anti-Cheat

Every reducer that modifies game state MUST validate inputs:
- **Range checks**: Is the action origin near the player's position?
- **Rate limiting**: Is the player firing faster than the weapon allows? (use `weapons::check_fire_rate()`)
- **Resource checks**: Does the player have ammo/health? (use `weapons::get_ammo()`)
- **Bounds checks**: Are coordinates within the world?
- **Speed validation**: Is the player moving faster than allowed?

Never trust client-reported values without validation.

### 7. Event Table Lifecycle

Short-lived event tables follow this pattern:
- `#[table(accessor = name, public)]` with `#[primary_key] #[auto_inc] pub id: u64`
- Include `created_at: Timestamp` for cleanup
- **Must have a scheduled cleanup reducer** that deletes rows older than N seconds
- Cleanup is scheduled via a `#[table(scheduled(reducer_name))]` table (see `ShotCleanup`, `DetachCleanup`)

### 8. Client-Side Prediction with Reconciliation

For features where instant feedback matters:
1. Apply the change locally immediately (client prediction)
2. Send the action to the server via reducer
3. Track what was predicted
4. When server confirms via table update, clear the prediction tracking
5. If server disagrees, the authoritative table update naturally corrects the client state
6. Skip redundant VFX for already-predicted changes (avoid double particles)

### 9. Vehicle Netcode Contract (Critical)

Vehicle prediction/reconciliation depends on a strict tick contract. Do not change this casually.

- **Server consumes exactly one queued vehicle input command per physics tick**
  - Inputs are queued in `VehicleInputCmd` rows (server-private table)
  - `tick_vehicles` pops at most one command per vehicle per tick
  - `acked_input_seq` MUST represent the last command actually consumed by physics, not just received
- **Coherent snapshot requirement**
  - Local reconcile MUST use Entity + Vehicle data from the same simulation tick
  - Use `sim_tick` for coherence checks (not wall-clock heuristics)
- **Client replay history is tick-aligned**
  - One history entry per local simulation tick
  - Never let replay logic assume packet-count == tick-count
- **Render-only correction**
  - Correction offsets may affect rendered pose only
  - Never mutate simulation state as part of visual smoothing
- **Mounted camera rule**
  - Do not add extra positional lerp on local mounted camera; vehicle mesh is already smooth
  - Extra camera lag re-introduces visible oscillation
- **Vehicle fire origin rule**
  - Use server-authoritative mounted pose (`getMountedVehiclePoseRaw`) when sending vehicle fire origin
  - Predicted pose can fail server range validation (`Shot origin too far from vehicle`)

---

## Architecture — When to Refactor

Use these rules to decide when new code needs a new file vs. extending an existing one:

### File Size Rule
**No file should exceed 500 lines.** If a file approaches this limit, split it. Exceptions are allowed only when the code is a single cohesive unit that can't be meaningfully divided (e.g., a complex algorithm).

### Single Responsibility Rule
Each file should have ONE clear domain. If you find yourself writing code that serves a different purpose than the file's name suggests, it belongs in a new file.

### Registry vs. Hardcoding Rule
If something can have multiple instances now or in the future (weapons, vehicles, biomes, structures, sound effects, HUD panels), it MUST use a registry pattern:
- Define an interface/trait
- Create one file per instance
- Register instances in a central list
- **Never** use `if (type === 0) ... else if (type === 1)` chains for extensible content

### Shared State Rule
If a value is used by both client and server, it MUST live in `shared/game-constants.json`. Never hardcode the same number in two places.

### Manager Pattern Rule
Client systems that manage collections of entities (players, vehicles, projectiles, lights) should follow this pattern:
- Own their maps/collections as class properties
- Accept an engine context interface (not the full Engine) for dependencies
- Expose `update(delta)`, `dispose()`, and domain-specific methods
- Be instantiated in Engine's constructor and called from `animate()`

### Dead Code & Legacy Cleanup Rule
After ANY refactor, design change, or feature removal, you MUST:
- **Delete** all code that is no longer called or reachable — unused functions, dead imports, orphaned files, commented-out blocks
- **Remove** backward-compatibility shims, legacy accessors, and wrapper functions that were only kept during migration
- **Search** for references before deleting to confirm nothing still depends on the code (`grep` / find usages)
- **Never** leave "just in case" dead code — it misleads future developers and AI agents into thinking it's active

If a refactor replaces an old pattern (e.g., flat ammo columns → normalized table, hardcoded arrays → registry), the OLD pattern must be fully removed in the same changeset. Do not leave both patterns coexisting.

### When to Create a New Module
You SHOULD create a new file/module when:
- A new entity type is added (weapon, vehicle, structure, biome, game mode)
- A method exceeds ~80 lines
- A class exceeds ~400 lines
- You're copy-pasting logic that already exists elsewhere
- Two developers could plausibly need to edit the same file for unrelated features

---

## Feature Implementation Checklist

When implementing ANY new feature:

1. **Check shared config** first: Does the feature need new values in `game-constants.json`?
2. **Server first**: Define table(s) and reducer(s) in the appropriate module
3. **Validate everything**: Use shared validation helpers (`check_fire_rate`, `get_ammo`, etc.)
4. **Event broadcasting**: If the feature has visual/audio effects, create an event table
5. **Cleanup**: If you create an event table, add scheduled cleanup
6. **Build server**: `cargo build --target wasm32-unknown-unknown --release`
7. **Publish**: `spacetime publish bitwars [--clear-database -y] --module-path ./spacetimedb`
8. **Regenerate bindings**: `spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb`
9. **Client integration**: Subscribe to new tables in `db.ts`, implement rendering in the appropriate manager
10. **Client prediction** (if needed): Predict locally, reconcile on server response
11. **Build client**: `bun run build` in `client/`

**Common mistakes to avoid:**
- Fixing or touching pre-existing build errors/warnings unrelated to your task — leave them alone
- Adding client-only effects that other players can't see
- Forgetting to publish/regenerate after server changes
- Trusting client input without server validation
- Using `lerp(pos, 0.3)` instead of the interpolation buffer for remote players
- Creating event tables without scheduled cleanup
- Editing files in `client/src/module_bindings/`
- **Forgetting to add new tables to `db.ts` subscription list** — callbacks will silently never fire
- Hardcoding a value that belongs in `game-constants.json`
- Duplicating weapon/vehicle data instead of using the registry
- Updating vehicle prediction without preserving the `sim_tick` + `acked_input_seq` coherence contract
- Reconciling local vehicle from stale cross-table snapshots (Entity tick must match Vehicle tick)
- Reintroducing mounted camera positional lerp (causes model-vs-camera oscillation)

---

## Client Architecture Details

### Engine.ts (2,981 lines — the orchestrator)

Engine.ts is the game's main class. It owns the Three.js scene, camera, renderer, and coordinates all sub-systems. Its two largest methods are:

- **`setupServerListeners()`** (~590 lines): All SpacetimeDB table callbacks. When adding a new server table listener, add it here.
- **`animate()`** (~367 lines): The per-frame game loop. Calls all sub-system `update()` methods.

Engine delegates to these managers (each has a context interface):
| Manager | Owns |
|---------|------|
| `VehicleManager` | Vehicle meshes, interpolation, camera, input, weapons |
| `RemotePlayerManager` | Remote player models, nametags, interpolation |
| `ChunkStreamer` | Chunk loading, streaming, bootstrap progress |
| `LanternSystem` | Lantern lights + glow sprites |
| `InfantryFireController` | Infantry fire pipeline + server sync |
| `VehicleFireController` | Vehicle fire pipeline + server sync |
| `WeaponSystem` | Fire logic, raycasting, ammo prediction |
| `ProjectileManager` | Client-side projectile flight + impact |
| `PhysicsSystem` | Falling block physics |
| `AudioSystem` | All sound (delegates to 7 sub-modules) |
| `SkySystem` | Sky dome, day/night, weather, fog |
| `VFX` | Particle effects |

### State Flow
```
SpacetimeDB Tables → Engine.setupServerListeners() → Engine internal state
Engine.animate() → assembles EngineState → onStateChange callback → React HUD
```

### Audio System
All sounds are procedurally generated (zero audio files). The system has three layers:

**Layer 1 — Infrastructure (`AudioCore.ts`)**:
- 5 submix buses: `weapon` (-3dB), `combat` (-2dB), `vehicle` (-4dB), `ui` (-6dB), `movement` (-8dB)
- `VoiceManager`: polyphony limits per category (weapon:12, combat:8, movement:8, flyby:6, ui:4), distance culling, voice stealing
- `NoisePool`: pre-allocated noise buffers (30 templates, 3 copies each), round-robin reuse — eliminates per-sound GC pressure
- Dynamic reverb: 2 delay taps driven by ray-traced room data
- Automatic node cleanup: `scheduleNodeCleanup()` disconnects orphaned spatial bus nodes after sound duration

**Layer 2 — Ray-Traced Acoustics (Web Worker)**:
- `AudioRayTracer.worker.ts`: runs on a background thread, receives chunk data, casts 48 DDA rays every ~60ms
- Computes: room reverb (from bounce distances), echo volume (return ratio), indoor/outdoor factor (escaped rays)
- **Sound propagation**: for each registered persistent source (vehicles), traces which rays' bounce points can "see" the source. The average initial direction of reaching rays = apparent sound direction (the "sound through doorway" effect)
- `AudioRayState.ts`: stores smoothed results, lerps direction (10x speed) and occlusion (6x speed) between worker updates

**Layer 3 — Sound Modules** (per-category files):
- Each play function specifies `bus`, `voiceCategory`, `voiceDuration` in its `SpatialBusOptions`
- `resolveOutput()` returns `null` when a voice is culled — all functions must handle this
- When adding new sounds, add them to the appropriate category module
- Vehicle sounds automatically use propagation data for apparent panner positioning

**Key rules for audio code:**
- Every `resolveOutput()` call can return `null` — always check before creating nodes
- One-shot sounds need `voiceDuration` for proper cleanup scheduling
- Persistent sounds (vehicle engines) must be registered/unregistered as sources via `AudioSystem.registerSoundSource()` / `unregisterSoundSource()`
- Chunk data is automatically sent to the worker on load/update/unload from `Engine.ts`
- Never allocate AudioBuffers per-sound — use `core.noise(duration, decay)` which returns from the pool

### Vehicle System
`VehicleManager` uses a type registry. Each vehicle type implements the `VehicleType` interface from `VehicleBase.ts`. The manager handles entity tracking, interpolation, camera, and input generically — type-specific logic (model, animation, breakup) lives in the type implementation.

---

## Server Architecture Details

### Modular Structure
The server is split into 50 focused files. `lib.rs` is just module declarations. Key patterns:

- **Weapon registry** (`weapons/mod.rs`): `get_weapon(index)` returns stats parsed from JSON. Ammo is in a normalized `PlayerAmmo` table (1 row per player+weapon). Adding a weapon = add JSON entry + optional `.rs` file.
- **Vehicle dispatcher** (`vehicles/mod.rs`): `tick_vehicles` dispatches to per-type physics (`helicopter.rs`). Adding a vehicle = new `.rs` file + match arm.
- **Shared combat helpers** (`combat/damage.rs`): `apply_hitscan_player_damage`, `apply_splash_player_damage`, `apply_hitscan_vehicle_damage`, `destroy_and_check_blocks`, `emit_explosion` — reused by infantry fire, vehicle fire, and grenades.
- **Weather presets** (`constants.rs`): Sourced from `game-constants.json`. Used by admin commands, environment tick, and init.

### Constants Pattern
Server constants in `constants.rs` are functions (not `const`) that read from `shared_config::config()` at runtime. This means they source from the shared JSON. Server-only values (spawn positions, scheduler intervals) remain as `const`.

---

## SpacetimeDB Rules (Critical)

Read `server/CLAUDE.md` before modifying server code. Key points:

- Use `spacetimedb` crate, NOT `spacetimedb-sdk`
- Do NOT derive `SpacetimeType` on `#[table]` structs
- Access tables via method: `ctx.db.table()` not field `ctx.db.table`
- Reducers take `&ReducerContext` (immutable), must be deterministic
- Reducers return `()` or `Result<(), String>` — they cannot return data
- Use `ctx.timestamp` and `ctx.rng` instead of `std::time` and `rand`
- `use spacetimedb::Table` is required for `.insert()`, `.iter()`, etc.

---

## Game Feel & Visual Style

- **Voxel world**: 16x16x16 chunks, RLE-compressed. Block types defined in `game-constants.json`
- **Lighting**: Dynamic day/night cycle via `SkySystem`. Lanterns via `LanternSystem`
- **Post-processing**: Bloom, color grading, damage vignette via `PostFX`
- **VFX**: Particle-based effects via instanced meshes in `VFX.ts` (MAX_PARTICLES = 2000)
- **Audio**: 100% procedural spatial audio via `AudioSystem` + 7 sub-modules + ray-traced acoustics worker
- **Screen shake**: Distance-attenuated, in `InfantryFireController`
- **Physics debris**: Falling blocks via `PhysicsSystem` (MAX_FALLING = 500)
- **Player models**: Box-based (body + head + nametag) via `RemotePlayerManager`

**Performance budget**: Target 60fps. Use instanced rendering. Limit per-frame allocations. Cap physics objects.

---

## Scaling & Future Feature Architecture

### Infrastructure Scaling
SpacetimeDB handles scaling — it runs all state in-memory on enterprise machines (80+ cores, 256 GB RAM) with dynamic scaling, automatic replication, and DDOS protection. The client is deployed to Cloudflare Workers (static assets, infinite scale). **No infrastructure architecture changes are needed from our side to scale.**

For very large scale (1000+ concurrent), SpacetimeDB Enterprise offers dedicated nodes, custom replication, and BYO cloud. The game design naturally supports sharding by running separate SpacetimeDB databases per match/lobby.

### Features That Need New Architecture (Not Yet Built)
These features do NOT exist yet. When implementing them, follow the existing registry/module patterns:

| Feature | Architecture approach |
|---------|----------------------|
| **Multiple maps** | Add map config to `game-constants.json` (seed, dimensions, biome weights). Map selection UI. Possibly separate SpacetimeDB databases per map. |
| **Lobbies/matchmaking** | Lobby service that provisions SpacetimeDB databases per match. Match browser UI. Player routing between databases. |
| **Game modes** (TDM, CTF, BR) | `server/gamemodes/` package with a `GameMode` trait. Per-mode scoring, spawn logic, win conditions. Mode-specific HUD components on client. |
| **Teams** | New `Team` table + team assignment reducer. Team-based spawn points, friendly fire config, team HUD colors. |
| **Progression/unlocks** | Persistent player profile table (XP, unlocks, stats). Separate from per-match state. |
| **Spectator mode** | Spectator camera system, free-fly + follow-player modes. No-fire, no-collision state. |

**IMPORTANT**: None of these require rearchitecting what exists. They build ON TOP of the current registry patterns, shared config, and modular file structure. A game mode system = new server package + new client manager. Teams = new table + reducers. Maps = config extension.

---

## Environment

- Database name: `bitwars` (on maincloud)
- Dashboard: https://spacetimedb.com/bitwars
- Client connects to `wss://maincloud.spacetimedb.com` (configurable via `VITE_SPACETIMEDB_URI`)
- Module name configurable via `VITE_MODULE_NAME` (defaults to `bitwars`)
- Package manager: **bun** (not npm)
