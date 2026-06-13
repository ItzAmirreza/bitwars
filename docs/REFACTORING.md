# Code Health Roadmap

This is the public refactoring roadmap for BitWars. Contributors are encouraged to pick tasks from it — every item below is concrete, scoped, and verified against the actual tree (line counts measured 2026-06-12).

BitWars is **source-available** (see `LICENSE`): the code is public and contributions are welcome, but it is not OSI open source. That doesn't change anything on this page — code health rules apply equally either way.

> Maintainer launch tasks live in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md). A few P0 items here (CI, deploy gating) overlap with it.

## The rules we're refactoring toward

These come straight from [`CLAUDE.md`](../CLAUDE.md) ("Architecture — When to Refactor"), the repo's own architecture guide:

- **~500-line max per file.** Exceptions only for single cohesive algorithms (documented below).
- **Single responsibility.** One file, one domain.
- **Registry patterns over if-chains.** Extensible content (weapons, vehicles, biomes, structures) gets one file per instance plus a central registry — never `if (type === 0) ... else if (type === 1)`.
- **Shared values live in `shared/game-constants.json`.** Never the same number in two places.
- **No dead code.** Refactors delete the old pattern in the same changeset.

## How refactors land

**Small, individually-buildable PRs — never big-bang rewrites.** Every PR must keep both builds green:

```bash
# client (from client/)
bun run build          # tsc -b && vite build

# server (from server/spacetimedb/)
cargo build --target wasm32-unknown-unknown --release
```

Run `bun run lint` (client) and `bun run bots:typecheck` (when touching `bots/`) too. A workstream like the Engine.ts decomposition is four or five separate PRs, each shippable on its own. If a refactor can't be broken into green-at-every-step slices, it's not ready to start.

Mechanical moves (extract module, no behavior change) are strongly preferred over rewrites. If you find a bug mid-refactor, fix it in a separate PR.

## How to claim a task

1. **Open a GitHub Issue first**, titled after the roadmap item (e.g. "Roadmap P1.8: registry-split WeaponAudio.ts") and referencing this document.
2. Wait for a maintainer thumbs-up before sinking serious time in — some items have ordering dependencies (most P1+ items want CI from P0.1 to exist first).
3. One workstream sub-item per PR. Keep diffs reviewable.

Items marked **GFI** (good first issue) are self-contained, low-risk, and don't require deep knowledge of the netcode or rendering pipeline.

---

## Current state

The hand-written codebase is **66,569 lines of TS/TSX/Rust across 209 files** (`client/src` 36,214 · `server/spacetimedb/src` 13,802 · `training/` 12,810 · `bots/src` 3,547). This excludes `client/src/module_bindings/` — 1,957 lines of auto-generated SpacetimeDB bindings in 46 files that are never hand-edited and exempt from all rules here.

**42 of 209 files (20%) exceed the repo's own 500-line rule.** All of them, with real line counts:

| Lines | File | Plan |
|---:|---|---|
| 5,008 | `client/src/game/Engine.ts` | P1.1 |
| 2,272 | `bots/src/bot.ts` | P1.3 |
| 1,492 | `training/src-tauri/src/sim/environment.rs` | P2.14 |
| 1,264 | `client/src/game/vehicles/VehicleManager.ts` | Deferred (netcode) |
| 1,048 | `client/src/screens/GameScreen.tsx` | P1.6 |
| 972 | `training/src-tauri/src/training_loop.rs` | P2.14 |
| 909 | `client/src/game/audio/WeaponAudio.ts` | P1.8 |
| 857 | `training/src-tauri/src/bridge.rs` | P2.14 |
| 841 | `client/src/screens/LoginScreen.tsx` | P2.11 |
| 822 | `client/src/game/ProjectileManager.ts` | P2.1 |
| 782 | `training/src-tauri/src/rl/ppo.rs` | Exception (cohesive algorithm) |
| 782 | `client/src/screens/hud/TacticalMap.tsx` | P2.11 |
| 772 | `client/src/game/RemotePlayerManager.ts` | P2.2 |
| 770 | `training/src/preview/MapView3D.tsx` | P2.14 |
| 750 | `client/src/game/vehicles/VehiclePhysics.ts` | Deferred (netcode) |
| 726 | `client/src/game/VoxelWorld.ts` | P2.3 |
| 721 | `client/src/screens/hud/BottomHud.tsx` | P2.11 |
| 715 | `client/src/game/FPSControls.ts` | P2.4 |
| 698 | `client/src/screens/LobbyScreen.tsx` | P2.11 |
| 674 | `client/src/game/audio/AudioCore.ts` | P2.5 |
| 636 | `client/src/game/vehicles/HelicopterType.ts` | P2.6 |
| 628 | `client/src/game/chunkMeshing.ts` | Exception (palette via P1.4) |
| 627 | `server/spacetimedb/src/constants.rs` | P0.5 + P2.12 |
| 612 | `client/src/screens/hud/LoadoutOverlay.tsx` | P2.11 |
| 608 | `server/spacetimedb/src/helpers/vehicle_helpers.rs` | P1.7 |
| 600 | `client/src/game/audio/AudioRayTracer.worker.ts` | Exception (cohesive algorithm) |
| 589 | `client/src/game/LanternSystem.ts` | P2.7 |
| 582 | `client/src/game/VFX.ts` | P2.8 |
| 579 | `server/spacetimedb/src/vehicles/weapons.rs` | P2.13 |
| 575 | `client/src/game/Weapons.ts` | P2.9 |
| 571 | `client/src/game/PerfHarness.ts` | P1.1a (relocate to `debug/`) |
| 571 | `client/src/game/ChunkStreamer.ts` | P2.10 |
| 567 | `client/src/game/vehicles/FighterJetType.ts` | P2.6 |
| 566 | `server/spacetimedb/src/tables.rs` | Exception (schema manifest) |
| 558 | `client/src/game/vehicles/AntiAirType.ts` | P2.6 |
| 538 | `client/src/App.tsx` | P2.11 |
| 523 | `client/src/game/NetDiagnostics.ts` | P1.1a (relocate to `debug/`) |
| 516 | `client/src/screens/PerfPanel.tsx` | Exception (debug tooling) |
| 510 | `client/src/game/SkyColors.ts` | P1.4 (data tables otherwise OK) |
| 506 | `client/src/game/audio/CombatAudio.ts` | Watch (split if it grows) |
| 504 | `client/src/game/vehicles/APCType.ts` | P2.6 |
| 502 | `client/src/game/audio/VehicleAudio.ts` | Watch (split if it grows) |

Other measured debts that don't show up as line counts:

- **3,058 lines duplicated byte-for-byte**: `training/src-tauri/src/worldgen/` is an identical copy of `server/spacetimedb/src/worldgen/` (16 files, zero diffs) → P1.2.
- **Block color palette defined 4 times**: `client/src/game/VoxelWorld.ts:38`, `client/src/game/chunkMeshing.ts:52`, `training/src/preview/ChunkMesher.ts:6`, `training/src/preview/MapView3D.tsx:25` → P1.4.
- **15 unit tests total** (server 5, training 10, client 0), no test runner in any package.json, **zero CI checks on PRs** → P0.1, P1.5.
- **No formatter config anywhere** (no `.editorconfig`, no Prettier config, no `rustfmt.toml`) → P0.4.
- **ESLint backlog**: `bun run lint` reports a backlog of findings (mostly `@typescript-eslint/no-explicit-any`, concentrated in `Engine.ts`, plus unused-var noise on `_`-prefixed names). CI runs lint **non-blocking** for now. First step: add `argsIgnorePattern`/`varsIgnorePattern: '^_'` to the eslint config to clear the underscore noise, then chip away at the `any`s file-by-file; once clean, make the CI lint step blocking again (`.github/workflows/ci.yml`).

---

## P0 — Safety and ground rules (do these first)

### P0.1 — PR CI, and gate the production deploy workflow
- **Files:** new `.github/workflows/ci.yml`; review `.github/workflows/deploy-server.yml`
- **Why first:** nothing currently builds, lints, or tests PRs — every refactor below is flying blind without this. Worse, `deploy-server.yml` triggers on *any push to `master` touching `server/**` or `shared/game-constants.json`* and publishes to production with `--clear-database`, wiping the live database. With external contributions in the mix, that trigger must be gated **before** merging server PRs becomes routine.
- **Target end-state:** `ci.yml` running on `pull_request` + `push`: (a) `bun install && bun run lint && bun run build` in `client/`, (b) `cargo build --target wasm32-unknown-unknown --release && cargo test` in `server/spacetimedb/`, (c) `bun run bots:typecheck`. Deploy workflow restricted to `workflow_dispatch` (or release tags) — maintainer decision, see [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).
- **Effort:** S · **Risk:** low · **GFI:** yes for `ci.yml`; the deploy gating itself is maintainer-only

### P0.2 — Sync `CLAUDE.md` with reality
- **Files:** `CLAUDE.md` (root)
- **Why:** it's the architecture map every contributor (human or AI) reads first, and it has drifted: Engine.ts documented as 2,981 lines (actual 5,008), GameScreen.tsx as 769 (actual 1,048), file counts stale, and it references `combat/bunker_buster.rs` and `hud/BunkerBusterDepthView.tsx`, which no longer exist (replaced by the kinetic penetrator). It also omits whole subsystems: `server/.../abilities/`, `matchmaking.rs`, the APC/Anti-Air vehicles, `TacticalMap`, and the entire `bots/` and `training/` trees.
- **Target end-state:** layout section matches `git ls-files`, line counts removed or corrected, dead references deleted, `bots/` + `training/` summarized.
- **Effort:** S · **Risk:** low · **GFI:** **yes**

### P0.3 — Rename `database metrics/` (directory name contains a space)
- **Files:** the 14 CSV exports under `database metrics/`
- **Why:** spaces in a top-level directory break unquoted shell loops and some CI glob syntax. Nothing in the code references the path (verified).
- **Target end-state:** `git mv "database metrics" docs/metrics` — or delete the folder entirely; the CSVs are one-off dashboard snapshots from 2026-03-17, not code (maintainer decides; see the launch checklist).
- **Effort:** S · **Risk:** low · **GFI:** **yes**

### P0.4 — Formatter and editor normalization
- **Files:** new `.editorconfig` at root; optional Prettier config in `client/`; `cargo fmt --check` in CI
- **Why:** contributors span Windows/macOS/Linux (the maintainer develops on Windows). With no formatter config, whitespace/EOL churn will pollute every diff.
- **Target end-state:** `.editorconfig` (LF, final newline, 2-space TS / 4-space Rust), `cargo fmt --check` added to `ci.yml`. Whether to adopt Prettier for TS is a maintainer call — if yes, land the one-time reformat as a standalone PR so it never mixes with logic changes.
- **Effort:** S · **Risk:** low · **GFI:** **yes**

### P0.5 — Delete the stale "legacy const shims" comment block
- **Files:** `server/spacetimedb/src/constants.rs` (lines ~614–627)
- **Why:** the file ends with a ~14-line comment block describing backward-compatible const aliases that were already deleted — nothing follows the comments. Violates the repo's own dead-code rule and misleads readers.
- **Target end-state:** comment block removed; `cargo build` green.
- **Effort:** S · **Risk:** low · **GFI:** **yes**

### P0.6 — Remove the empty `weapons/sniper.rs` stub
- **Files:** `server/spacetimedb/src/weapons/sniper.rs` (~3 lines, no behavior) and its `pub mod sniper;` line in `weapons/mod.rs`
- **Why:** every other per-weapon file carries real logic; this one is an empty placeholder. Per the registry rule, a weapon with no special server behavior needs no `.rs` file at all — the registry reads its stats from `game-constants.json`. The empty file misleads readers into thinking the sniper has custom server logic.
- **Target end-state:** confirm nothing imports it, then delete the file and its `pub mod` line; `cargo build` green.
- **Effort:** S · **Risk:** low · **GFI:** **yes**

---

## P1 — Big structural wins

### P1.1 — Decompose `Engine.ts` (5,008 lines)
The orchestrator has grown 68% past its own documentation and is the first file every gameplay contributor must read. Four mechanical extractions, **each its own PR**, all following the existing manager pattern (own collections, accept a narrow context interface, expose `update(delta)`/`dispose()`):

| Sub-item | What moves | Target module |
|---|---|---|
| **a. Perf sandbox + debug tooling** | The embedded perf-benchmark scene (`setPerfSandboxMotion`, `emitSandboxChaos`, `applySandboxMotion`, … ~700 lines) plus relocating `PerfHarness.ts` (571), `NetDiagnostics.ts` (523), `PerfWorldScene.ts`, `PerfHistoryStore.ts`, `ChunkBoundaryViewer.ts` | `client/src/game/debug/EnginePerfSandbox.ts` + `client/src/game/debug/` folder, so shipping systems and instrumentation are visually distinct |
| **b. Server listeners** | The nine listener installers — `setupChunkListeners`, `setupStructuralListeners`, `setupPlayerListeners`, `setupCombatEventListeners`, `setupVehicleListeners`, `setupEnvironmentListeners`, `setupAmmoAndLoadoutListeners`, `setupGrenadeListeners`, `setupAbilityListeners` (Engine.ts lines 2653–3652, ~1,000+ lines) | `client/src/game/listeners/` — one module per installer, each receiving an `EngineListenerContext` interface |
| **c. Damage indicators** | `registerIncomingShotCandidate` through `buildDamageIndicatorHudState` (~250 lines) | `client/src/game/DamageIndicatorSystem.ts` |
| **d. Dynamic lights** | `addDynamicLight` / `updateDynamicLight` / `removeDynamicLight` / `updateDynamicLights` (~150 lines) | `client/src/game/DynamicLightManager.ts` |
| **e. Animate loop + warmup audit** | After a–d land: audit the ~370-line `animate()` loop and the warmup/graphics-tier code for further extraction (e.g. `EngineWarmup.ts`) if Engine is still well above target | follow-up issue, scoped after a–d |

- **Target end-state:** Engine.ts ≈ 2,400 lines of genuine orchestration; each extraction independently reviewable.
- **Effort:** L (as a workstream; each sub-item is S–M) · **Risk:** medium — Engine touches everything, which is exactly why each slice must build and play cleanly on its own. Wants P0.1 (CI) first. · **GFI:** no

### P1.2 — De-duplicate worldgen into a shared crate
- **Files:** `server/spacetimedb/src/worldgen/` and `training/src-tauri/src/worldgen/` — 16 files, 3,058 lines, byte-identical (verified with `diff -rq`: zero differences)
- **Why:** any worldgen change must currently be hand-copied, or the trainer silently trains on a stale world. Largest duplication in the repo.
- **Target end-state:** a `worldgen` library crate (e.g. `shared/worldgen/` or `server/worldgen-core/`) containing the SpacetimeDB-independent generation logic; both `server/spacetimedb` and `training/src-tauri` depend on it via path dependency. The code already compiles unchanged in both contexts, so this is mostly `Cargo.toml` plumbing. Both `cargo build`s verify it. **Until this lands, the registry-pattern payoff is halved** — any new biome or structure must be authored twice (server copy + training copy), and the trainer silently trains on a stale world if only one side is updated.
- **Effort:** M · **Risk:** medium (build plumbing, not logic) · **GFI:** no

### P1.3 — Split `bots/src/bot.ts` (2,272 lines) and registry-ize its weapon logic
- **Files:** `bots/src/bot.ts`
- **Why:** second-largest hand-written file; one `HeadlessBitBot` god-class doing connection, movement sync, targeting, navigation, cover seeking, and fire control. Bots are also the friendliest contributor playground — headless, no client build, easy to smoke-test against a local SpacetimeDB.
- **Target end-state:** a `bots/src/bot/` package — `BotConnection.ts` (subscriptions, token persistence), `BotMovement.ts` (movement sync + history), `BotTargeting.ts` (target scoring), `BotNavigation.ts` (waypoints, hotspots, cover), `BotCombat.ts` (weapon choice, breaching, fire control) — with `HeadlessBitBot` as a thin composer. Separately, replace the per-weapon `switch` chains (e.g. `idealRangeForWeapon`, lines ~1166–1190) with a data table keyed off the shared weapon config the bot already imports, per the registry rule.
- **Effort:** M · **Risk:** low · **GFI:** the switch-chain → data-table piece is a **GFI**; the package split is not

### P1.4 — Move block colors and weather names into `game-constants.json`
- **Files:** `shared/game-constants.json`; `client/src/game/VoxelWorld.ts:38`, `client/src/game/chunkMeshing.ts:52`, `training/src/preview/ChunkMesher.ts:6`, `training/src/preview/MapView3D.tsx:25` (four independent `BLOCK_COLORS` palettes); `client/src/game/SkyColors.ts:3–10` (`WEATHER_NAMES` hardcoded with the comment "must match server")
- **Why:** the repo's loudest rule — single source of truth — violated four times over for block colors and once for weather names, while `game-constants.json` already carries `blockTypes` and the `weather` presets.
- **Target end-state:** a color field per block type in the shared config; all four palettes derive from it (hex on client, RGB floats in the trainer preview). Weather names/indices imported from the config's `weather` array. Trivially eyeball-verifiable in-game.
- **Effort:** S · **Risk:** low · **GFI:** **yes**

### P1.5 — First test infrastructure (three highest-value targets)
- **Files:** add vitest (or equivalent) to `client/package.json`; new test files; wire `cargo test` into CI (P0.1)
- **Why:** 15 unit tests exist in the whole repo (5 in `server/.../combat/projectile.rs`, 10 in `training/src-tauri`), zero on the client, and no test script anywhere. Refactoring P1/P2 safely needs at least a seed of coverage.
- **Target end-state — the first three targets, one PR each:**
  1. **Shared-config validation** (Rust, `server/spacetimedb/src/shared_config.rs`): a `cargo test` that parses `shared/game-constants.json` and asserts invariants — every weapon has positive damage/fire-rate/ammo, vehicle types match registered IDs, weather presets complete. Catches the most common contributor mistake (malformed config edits) at test time instead of at runtime.
  2. **`InterpolationBuffer.ts`** (client): pure logic, no Three.js — snapshot ordering, 100 ms delay interpolation, extrapolation cap. This class underpins all remote-entity smoothness.
  3. **Worldgen determinism** (Rust, in the P1.2 crate or in place): same seed + chunk coordinates → byte-identical chunk output, twice in a row. Guards procedural generation against accidental nondeterminism and doubles as the safety net for the P1.2 crate extraction.
  - Next in line after these: `chunkMeshing.ts`, `VoxelCollision.ts`, `explosionPattern.ts` — all pure logic.
- **Effort:** S–M per target · **Risk:** low · **GFI:** **yes** (each target individually)

### P1.6 — Split `GameScreen.tsx` (1,048 lines) into hooks
- **Files:** `client/src/screens/GameScreen.tsx`
- **Target end-state:** following the existing `screens/hooks/` pattern (`useKillTracking`, `useChat`, `useTacticalMap` already live there): extract `hooks/useEngineLifecycle.ts` (engine create/destroy + settings effects), `hooks/useGameInput.ts` (key/pointer routing effects), and a `LoadingOverlay.tsx` component for the loading-stage UI. Effects move wholesale; no behavior change.
- **Effort:** M · **Risk:** medium (React effect ordering) · **GFI:** no

### P1.7 — Split `vehicle_helpers.rs` and dedupe the AA slot clamp
- **Files:** `server/spacetimedb/src/helpers/vehicle_helpers.rs` (608); `server/spacetimedb/src/vehicles/weapons.rs` (lines ~144 and ~543); `server/spacetimedb/src/vehicles/anti_air.rs` (~line 64)
- **Why:** the one clearly mixed-responsibility server file — pure hitbox geometry (`vehicle_hitbox_*`, AABB math) sharing a file with table-mutating gameplay ops (`dismount_player_internal`, `apply_vehicle_damage`). The same "self-heal legacy rows stuck on old SAM slot" clamp is duplicated in three places.
- **Target end-state:** `helpers/vehicle_hitbox.rs` (pure math, unit-testable — pairs with P1.5) + `helpers/vehicle_state.rs` (mount/damage ops). One shared AA slot-clamp helper. The clamp is legacy "self-heal" migration code repeated in 3 spots (`vehicles/weapons.rs:144`, `:543`, `vehicles/anti_air.rs:64`); beyond deduping it into one helper, consider a one-time data migration so the clamp doesn't run on every fire/tick forever.
- **Effort:** S · **Risk:** medium (combat code — review with care) · **GFI:** no

### P1.8 — Registry-split `WeaponAudio.ts` per weapon
- **Files:** `client/src/game/audio/WeaponAudio.ts` (909 lines — 15 procedural synth functions of 40–80 lines each)
- **Why:** the server already follows one-file-per-weapon (`server/.../weapons/rifle.rs` …); the client audio side should mirror it so "add a weapon" touches symmetric files on both sides — exactly the workflow `CLAUDE.md` teaches.
- **Target end-state:** `client/src/game/audio/weapons/` — one file per weapon exporting its play function, plus an `index.ts` mapping weapon index → function. Procedural audio is self-contained and aurally verifiable.
- **Effort:** M · **Risk:** low · **GFI:** **yes**

---

## P2 — Opportunistic splits (good roadmap issues, no urgency)

Each row is a single extraction PR. Pattern reference: managers per `CLAUDE.md`'s Manager Pattern Rule.

| ID | File (lines) | Target end-state | Effort | Risk | GFI |
|---|---|---|---|---|---|
| P2.1 | `client/src/game/ProjectileManager.ts` (822) | Extract `ProjectileImpact.ts` (impact resolution vs blocks/players/vehicles, ~330 lines); spawning/flight/pooling stay | M | med | no |
| P2.2 | `client/src/game/RemotePlayerManager.ts` (772) | Extract `RemotePlayerModel.ts` (mesh + nametag construction, ~280 lines) from lifecycle/interpolation | S | low | yes |
| P2.3 | `client/src/game/VoxelWorld.ts` (726) | Extract chunk-mesh bookkeeping into `ChunkMeshStore.ts`; palette goes to shared config via P1.4 | M | med | no |
| P2.4 | `client/src/game/FPSControls.ts` (715) | Extract `FlyControls.ts` (fly-mode state + update); sandbox input overrides move with P1.1a | S | low | yes |
| P2.5 | `client/src/game/audio/AudioCore.ts` (674) | Extract `SpatialBus.ts` (panner + legacy Web Audio compat) and `ReverbBus.ts` (delay-tap reverb) | M | med | no |
| P2.6 | `vehicles/HelicopterType.ts` (636), `FighterJetType.ts` (567), `AntiAirType.ts` (558), `APCType.ts` (504) | Extract shared breakup logic into `vehicles/VehicleBreakup.ts`; all four registry entries drop under 500 | M | low | no |
| P2.7 | `client/src/game/LanternSystem.ts` (589) | Extract glow-sprite atlas/material creation into `LanternSprites.ts` | S | low | yes |
| P2.8 | `client/src/game/VFX.ts` (582) | Split effect presets (explosion/muzzle/debris emitters) into `vfx/presets.ts`; instanced-pool engine stays | S | low | yes |
| P2.9 | `client/src/game/Weapons.ts` (575) | Extract `WeaponRaycast.ts` (hit-scan vs players/vehicles/blocks) from loadout/ammo state | M | med | no |
| P2.10 | `client/src/game/ChunkStreamer.ts` (571) | Extract `ChunkRequestQueue.ts` (request queue/bootstrap/reaping priority logic) from hydration | M | med | no |
| P2.11 | UI: `LoginScreen.tsx` (841), `TacticalMap.tsx` (782), `BottomHud.tsx` (721), `LobbyScreen.tsx` (698), `LoadoutOverlay.tsx` (612), `App.tsx` (538) | One PR per screen: `login/LoginDecor.tsx` + `login/AuthProviders.tsx`; `hud/map/MapMarkers.tsx`; `hud/WeaponIcons.tsx` (reusable by KillFeed/Loadout); `lobby/MatchList.tsx` + `lobby/PlayerRoster.tsx`; `hud/WeaponSilhouettes.tsx`; `UpdateBanner.tsx` + `versionReload.ts` | S–M each | low | yes (each) |
| P2.12 | `server/spacetimedb/src/constants.rs` (627) | Split by config domain: `constants/{combat,vehicles,world,abilities}.rs` re-exported from `constants/mod.rs` (call sites unchanged). P0.5 deletes the dead comments first | M | low | no |
| P2.13 | `server/spacetimedb/src/vehicles/weapons.rs` (579) | Extract per-slot fire validation into `vehicles/fire_validation.rs` (clamp dedupe handled in P1.7) | S | med | no |
| P2.14 | Training app: `sim/environment.rs` (1,492), `training_loop.rs` (972), `bridge.rs` (857), `preview/MapView3D.tsx` (770) | `sim/env/{observations,rewards,episode}.rs`; extract `rollout.rs`; split Tauri commands by domain (`bridge/{training,preview,checkpoint}_cmds.rs`); extract `preview/PreviewScene.ts` from the React component | M each | low–med | no |

---

## Deferred — do not start yet

**`VehicleManager.ts` (1,264) and `VehiclePhysics.ts` (750).** Both sit directly on the vehicle netcode contract (`sim_tick` + `acked_input_seq` coherence, tick-aligned replay) that `CLAUDE.md` explicitly flags as fragile. The intended end-state is known — extract `VehicleQuery.ts` (read-only lookups) and `VehicleDestroyFx.ts` from the manager, move per-type physics integration into the existing `*Type.ts` registry files, and finish removing the fields marked "Legacy fields kept for mount-transition seeding in Engine.ts" — but these land only **after** CI (P0.1) exists and with manual multiplayer verification. If you want to work on vehicles, talk to a maintainer first.

## Documented exceptions to the 500-line rule

These stay as-is; don't open split PRs for them:

- `server/spacetimedb/src/tables.rs` (566) — the schema manifest, deliberately one file per `CLAUDE.md`.
- `client/src/game/chunkMeshing.ts` (628) — single meshing algorithm shared by worker + main thread (its palette still moves to shared config via P1.4).
- `client/src/game/audio/AudioRayTracer.worker.ts` (600) — cohesive DDA raycasting algorithm in a worker.
- `training/src-tauri/src/rl/ppo.rs` (782) — cohesive PPO implementation with its own tests.
- `client/src/screens/PerfPanel.tsx` (516) and the debug tooling relocated by P1.1a — dev instrumentation, fine at this size once grouped under `debug/`.
- `client/src/game/SkyColors.ts` (510) — mostly color data tables; only the duplicated weather names move (P1.4).
- `client/src/game/audio/CombatAudio.ts` (506) and `VehicleAudio.ts` (502) — borderline; split per-category/per-vehicle-type only if they grow.
