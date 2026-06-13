# Audio Overhaul v2 — sample-based (P0.2 / issue #85)

## v2: real samples replace procedural synth (the actual fix)
User feedback: procedural synth "sounds like bits"; wants a real overhaul + samples allowed.
- [x] Cut the block/terrain hit tick (both fire controllers) — user disliked it
- [x] Source CC0 assets: Kenney (UI/impact/sci-fi), OpenGameArt firearm library + calm music
- [x] Convert/trim → mono MP3 (Safari-safe) into `client/public/audio/` (~1 MB); `CREDITS.md`
- [x] `SampleLibrary.ts` — manifest + fetch + decode + cache + random variants; preloaded in `ensure()`
- [x] `AudioCore.playSample()` (spatial, via panner/bus/reverb) + `playSampleOnBus()` (UI/music)
- [x] Wire weapons (rifle/shotgun/sniper/mg/minigun/rpg+rockets), explosion(+boom), blockbreak,
      hitmarker, killconfirm, damage, footsteps, landing, UI (hover/click/nav/deploy/error)
- [x] Menu = real looping CC0 track (fallback to procedural pad if sample missing)
- [x] Every play fn keeps procedural FALLBACK when a sample isn't loaded
- [x] Build passes (tsc + vite)
- [ ] USER AUDITION → tune gains / swap any files they dislike (drop-in, no code change)
- Still procedural (no sample yet): reload, reloadComplete, lowAmmo, emptyClick, switch, jump,
  death, heartbeat, respawn, crumble, blockLand, flyby, vehicle engines

---

# Audio Pleasantness Overhaul (P0.2 / issue #85) — v1 (synthesis tuning, superseded by v2)

## Goal
Make all procedural audio warmer and more pleasant to the human ear without losing impact.
Replace the harsh menu drone with a warm pad. Add missing P0.2 cues.

## Tasks
- [x] **Part 1 — Master warmth chain** (`AudioCore.ts`)
  - [x] `makeSaturationCurve()` tanh helper (normalized)
  - [x] WaveShaper saturator + high-shelf (-3 dB @ 7 kHz) in `ensure()`
  - [x] New chain: master → saturator → compressor → highShelf → limiter → destination
  - [x] Null new nodes in `dispose()`
- [x] **Part 5 — Bus balance** (`AudioCore.ts` `BUS_LEVELS`)
  - [x] movement -8→-6 dB (footstep clarity), ui -6→-5, weapon -3→-3.5
- [x] **Part 2 — Warm ambient pad** (`AmbientAudio.ts`)
  - [x] A-minor pad (A2/E3/A3/C4), triangle+sine, detune, breathing LPF + subtle tremolo
  - [x] 3 s fade-in / 2.5 s fade-out, array-based teardown (no osc leak)
- [x] **Part 3 — Tonal tuning** (`UIAudio.ts`, `CombatAudio.ts`, `weapons/rifle.ts`)
  - [x] UI hover/click/error/type softened; hitmarker + killConfirm ceilings lowered
  - [x] Rifle metallic ping + shell casing lowered
- [x] **Part 4 — New cues**
  - [x] `playLowAmmo` + `playReloadComplete` (`weapons/actions.ts`, exported, facade)
  - [x] `playHitMarker(kind)` block vs player variation (`CombatAudio.ts`, facade)
  - [x] Wiring: low-ammo (InfantryFireController), reload-complete (Engine + VehicleFireController),
        block/player hitmarker (both fire controllers)
- [x] **Verify**: `bun install` + `bun run build` (tsc + vite) — PASSES. `bun run lint` has only
      pre-existing repo-wide errors; my 12 modified files add zero new lint errors (verified by
      linting them in isolation — the 8 reported are pre-existing `any`/boolean-cast in untouched
      server-sync code, line numbers shifted by my insertions above).

## Review
Client-only change; no server/bindings/shared-config touched. Master saturator is the single
biggest perceptual win (warms every sound). Block hits now produce a (subtle, voice-capped)
hitmarker tick — previously silent on the crosshair-confirm layer.

Finding: infantry weapons have NO `reloadTime` in shared config (only vehicle weapons do) and the
server `reload_weapon` reducer refills ammo instantly. So the infantry reload-complete cue is
scheduled at a fixed 700 ms to land just after the ~0.65 s `playReload` click sequence. Vehicle
reload-complete fires on the real `reloadTime` timer in `tickVehicleReload`.

## How to test
- Menu: warm evolving pad, no drone/wobble; sit 30 s+ (not fatiguing).
- UI: hover/click/type/error softer but clear.
- Combat: rifle ping less harsh; player vs block hitmarkers distinct; reload-complete confirm at
  end of reload; one soft low-ammo tock at ~20% ammo; explosions still punchy, warmer top end;
  nearby footsteps clearer. No clipping.
