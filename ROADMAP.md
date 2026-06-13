# BitWars Product Roadmap

This is the **product and gameplay roadmap** for BitWars — where the *game* is going. It is the companion to two existing docs:

| Doc | Track |
|-----|-------|
| **ROADMAP.md** (this file) | **Product** — features, gameplay, content, the player experience |
| [`docs/REFACTORING.md`](docs/REFACTORING.md) | **Engineering** — code health, file splits, test infra, internal cleanup |
| [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) | **Launch ops** — maintainer-only go-public checklist |

The two roadmaps run in parallel. A clean codebase (the engineering track) is what lets the product track move fast — but this file is about what players will *feel*, not how the code is organized.

BitWars is **alpha**. It already has a lot — 6 infantry weapons, 4 vehicles with 7 vehicle weapons, fully destructible terrain, procedural worldgen, ray-traced procedural audio, neural-net bots, and serious netcode — but the experience is still raw. This roadmap is the plan to take it from "impressive tech demo with a real game inside it" to a game people return to.

> BitWars is **source-available** (see [`LICENSE`](LICENSE)): public so you can study it and contribute, but not OSI open source. That doesn't change anything here — the roadmap is open, contributions are welcome.

---

## The North Star

> **A new player loads fast, lands in a populated, fun, fair match within seconds — and has a reason to come back.**

Everything below is sequenced against that sentence. For a freshly-launched multiplayer browser FPS, the single biggest failure mode is **empty or janky matches**: meta systems (ranked, unlocks, leaderboards) are worthless if the core ten-minute experience isn't fun and reliably populated. So the core loop comes first, retention systems second, breadth third, and the ambitious long-horizon work last.

## How to read the priorities

Items are numbered by **priority order**, not by date — `P0` before `P1` before `P2` before `P3`, and within a tier `P0.1` before `P0.2`. There are deliberately **no dates**: this is a small-team-plus-community project, and dated promises on a roadmap age into liabilities. Priority can and will be re-ordered as we learn from real players (see [Feedback](#feedback--how-this-roadmap-changes)).

- **P0 — Core loop.** Make the match fun, fair, populated, and fast to get into. Nothing else matters until this is good.
- **P1 — Identity & retention.** Accounts, progression, leaderboards, anti-cheat, social — reasons to come back, and the foundation competitive play requires.
- **P2 — Content & competition.** Maps, game modes, teams, ranked, more weapons/vehicles, better characters.
- **P3 — Depth, polish & reach.** Spectator/replays, visual & physics depth, regions, mobile, moderation at scale.

Each item carries compact tags:

- **Effort:** S (days) · M (a couple of weeks) · L (a multi-PR workstream)
- **Touches:** `client`, `server`, or both — and `shared` when it needs `game-constants.json`
- **Depends on:** items that should land first
- **Contributor entry:** the slice a new contributor could pick up without owning the whole epic

Each item is an **epic**. Picking one up means breaking it into shippable, individually-buildable PRs — same discipline as the engineering roadmap: keep both builds green at every step, server-authoritative, registry patterns over if-chains, shared values in `shared/game-constants.json`. See [`CLAUDE.md`](CLAUDE.md).

---

## P0 — Core loop: fun, fair, populated, fast

The whole tier is the North Star sentence, decomposed. This is the *Now*.

### P0.1 — Combat & game-feel pass
The shooting has to feel *good* before anything else is worth doing. This is the most important item on the entire roadmap.
- **Scope:** Tighten weapon feel end-to-end — recoil curves, spread, time-to-kill balance across all 6 infantry weapons, and trustworthy hit registration (server-authoritative, but the client must *feel* the hit instantly). Add crisp combat feedback: hit markers, directional damage indicators (the system already exists in `Engine.ts` — make it sing), kill confirmation, and weight to impacts via `VFX` + screen shake. Audit `Weapons.ts` spread/recoil and `InfantryFireController` feedback.
- **Why first:** Players forgive missing features; they do not forgive a gun that feels mushy. Get the moment-to-moment right and everything downstream converts better.
- **Effort:** L · **Touches:** client + `shared` (tuning) · **Contributor entry:** per-weapon recoil/feedback tuning is a great self-contained PR (one weapon at a time).

### P0.2 — Audio depth & mix pass
The 100%-procedural, ray-traced audio is a standout feature — but the mix is still raw.
- **Scope:** Layer and punch up weapon/combat sounds, balance the five submix buses (`weapon`/`combat`/`vehicle`/`ui`/`movement`), tune the dynamic reverb and occlusion so the "sound through a doorway" propagation reads clearly in real fights. Add missing audio cues (low-ammo, reload-complete, hitmarker tick, nearby-footstep clarity). Per [`docs/REFACTORING.md`](docs/REFACTORING.md) P1.8, `WeaponAudio.ts` is being split one-file-per-weapon — that split makes this pass easier.
- **Effort:** M · **Touches:** client · **Contributor entry:** a single new procedural cue (e.g. low-ammo click) end-to-end. **Aurally verifiable**, no netcode knowledge needed.

### P0.3 — Bot overhaul
Bots are the answer to the empty-server problem, and right now they aren't good enough to be either fun opponents or convincing fill.
- **Scope:** Make bots good enough to (a) backfill low-population matches so nobody loads into an empty world, and (b) provide a credible solo/warmup experience. Improve targeting, navigation quality, weapon selection, and cover use in `bots/` (and the PPO nav model in `training/`). Tie difficulty to a tunable so backfill bots can scale to lobby skill. Aligns with [`docs/REFACTORING.md`](docs/REFACTORING.md) P1.3 (split `bot.ts`, registry-ize weapon logic).
- **Why P0:** A multiplayer game with nobody to shoot is dead on arrival. Good bots are the bridge until population is self-sustaining — and they pair directly with P0.4.
- **Effort:** L · **Touches:** `bots/`, `training/`, light `server` (backfill spawn policy) · **Depends on:** benefits from P0.4's backfill hooks · **Contributor entry:** the `idealRangeForWeapon` switch → data-table conversion (already a GFI in the engineering roadmap).

### P0.4 — Matchmaking & match-flow polish
Single-match flow already exists (`server/matchmaking.rs`, `useMatchSession.ts`, `MatchVictoryOverlay.tsx`). Make it *feel* seamless and never leave a player alone.
- **Scope:** Auto-fill matches; backfill with P0.3 bots when human population is low and gracefully hand seats back to humans as they join; tighten the round → intermission → results → "play again" loop so there's zero dead air; clear "players in match" visibility from the lobby. This is match *experience*, distinct from the future cross-database matchmaking service (that's P2/P3 territory; see `CLAUDE.md`).
- **Effort:** M · **Touches:** `server` + `client` · **Depends on:** P0.3 (for bot backfill) · **Contributor entry:** the "play again without reloading" client flow.

### P0.5 — New-player onboarding & first session
For a browser game, the first 60 seconds decide whether someone stays. `TutorialOverlay` exists — make it actually teach the game.
- **Scope:** A first-session flow that teaches the three things that make BitWars *BitWars* — move/shoot, **destroy terrain**, and use a vehicle — without a wall of text. Sane default loadout, a clear first objective, and a frictionless "click → playing" path (no account wall — anonymous play stays). Empty/loading states that explain what's happening.
- **Effort:** M · **Touches:** client · **Contributor entry:** improving a single tutorial step or empty-state screen.

### P0.6 — Client load-time & startup optimization
It's a browser game with no install — the flip side is the bundle *is* the install, every time. First paint to first match has to be fast.
- **Scope:** Code-split the bundle (defer training/debug/perf tooling and rarely-used screens), lazy-load heavy assets, audit what loads before a player can move, and cut time-to-first-match. Measure with the existing `benchmarks/` harness so wins are provable. (Runtime/frame-rate perf and structural file splits live in [`docs/REFACTORING.md`](docs/REFACTORING.md); this item is specifically about *load* and *bundle* — the player's first impression.)
- **Effort:** M · **Touches:** client (Vite config, dynamic imports) · **Contributor entry:** lazy-loading one heavy, non-critical module and measuring the bundle delta.

### P0.7 — Lightweight, privacy-respecting telemetry
You can't prioritize what you can't measure. This is small, and it makes every other item smarter.
- **Scope:** Anonymous, aggregate gameplay metrics — session length, where new players drop off, match fill rate, weapon pick/kill rates, crash/error reporting. No PII; honor the existing privacy policy. Just enough to answer "did the P0.1 feel pass actually help" and "which weapon is over/underpowered" with data instead of vibes.
- **Effort:** S–M · **Touches:** client + light `server` · **Contributor entry:** wiring a single funnel event (e.g. "reached first kill").

---

## P1 — Identity, retention & fairness

Once the match is fun, give players an identity, a reason to return, and the integrity foundation that competitive play (P2) requires.

### P1.1 — Accounts & persistent identity
Today play is anonymous and ephemeral. Persistence is the prerequisite for everything in this tier.
- **Scope:** Optional accounts (anonymous play *stays* — accounts are upgrade, not gate) with a persistent player profile table separate from per-match state, keyed off SpacetimeDB Identity. Stable display names, basic auth flow building on the existing `LoginScreen`.
- **Effort:** L · **Touches:** `server` (new persistent tables) + `client` · **Contributor entry:** profile-view UI once the table exists.

### P1.2 — Player profiles & career stats
- **Scope:** Persistent career stats (K/D, wins, favorite weapon, blocks destroyed, playtime) on the P1.1 profile; an in-client profile screen. Turns one-off matches into a personal track record.
- **Effort:** M · **Touches:** `server` + `client` · **Depends on:** P1.1.

### P1.3 — Leaderboards
- **Scope:** Global and seasonal leaderboards (kills, wins, win-rate, longest streak). Seasons keep them fresh and give lapsed players a reason to return at reset. Surfaced in the lobby.
- **Effort:** M · **Touches:** `server` + `client` · **Depends on:** P1.1, P1.2.

### P1.4 — Progression & cosmetic unlocks
Because the license forbids commercialization, cosmetics aren't a revenue lever — they're the **retention and identity** lever. Earn-only, all the more reason to make them feel good.
- **Scope:** XP/levels from match performance, and earnable cosmetic identity within the 8-bit aesthetic (player-color/skin variants, weapon charms, nameplate flair, kill-feed accents). Must respect [`DESIGN.md`](DESIGN.md) — chunky, square, hard-shadowed; no PBR, no rounded corners. Use a registry so each cosmetic is a data entry, not a special case.
- **Effort:** L · **Touches:** `server` + `client` + `shared` · **Depends on:** P1.1 · **Contributor entry:** authoring one cosmetic through the registry.

### P1.5 — Anti-cheat & fairness hardening
**Ranked (P2.5) cannot ship without this.** The architecture is already server-authoritative — this is about closing the gaps and adding detection.
- **Scope:** Audit every reducer for validation completeness (the `CLAUDE.md` checklist: range, rate, resource, bounds, speed); add server-side anomaly detection (impossible accuracy, speed, fire-rate, teleport); rate-limit and sanity-check all client-reported inputs; lay groundwork for reporting (P3.6). Document the trust model.
- **Effort:** L · **Touches:** `server` (primarily) · **Depends on:** nothing — can run alongside P1.1.

### P1.6 — Social: friends, parties & invites
Multiplayer games grow through people bringing people.
- **Scope:** Friends list, party-up (queue into the same match together), and a shareable invite/deep-link so a player can pull a friend straight into their match. Builds on P1.1 identity.
- **Effort:** L · **Touches:** `server` + `client` · **Depends on:** P1.1, and P0.4 match flow.

---

## P2 — Content, variety & competition

With a fun, sticky, fair core, add breadth and a competitive ladder. Several of these already have an architecture sketch in [`CLAUDE.md`](CLAUDE.md) ("Features That Need New Architecture") — follow those patterns.

### P2.1 — Multiple maps
- **Scope:** Map configuration in `game-constants.json` (seed, dimensions, biome weights), a map-selection path, and possibly separate SpacetimeDB databases per map at scale. Worldgen is already procedural and seed-driven — this is largely config + selection UI. **Land [`docs/REFACTORING.md`](docs/REFACTORING.md) P1.2 (shared worldgen crate) first** so maps don't have to be authored twice.
- **Effort:** M–L · **Touches:** `shared` + `server` + `client` · **Depends on:** REFACTORING P1.2.

### P2.2 — Game modes (TDM / CTF / BR / …)
- **Scope:** A `server/gamemodes/` package with a `GameMode` trait — per-mode scoring, spawn logic, win conditions — and mode-specific HUD on the client. Registry pattern: one file per mode, never an if-chain. This is the single biggest *variety* unlock in the game.
- **Effort:** L · **Touches:** `server` + `client` · **Contributor entry:** a simple mode (e.g. Gun Game / FFA variant) once the trait exists.

### P2.3 — Teams
- **Scope:** A `Team` table + assignment reducer, team spawn points, friendly-fire config, and team colors in the HUD. Prerequisite for TDM/CTF and team-ranked.
- **Effort:** M · **Touches:** `server` + `client` · **Depends on:** P2.2 (co-designed).

### P2.4 — More weapons & vehicles
- **Scope:** Expand the arsenal through the existing registries (add to `game-constants.json`, one file per weapon/vehicle on each side). The pipeline is well-trodden — this is content velocity, paced so each addition is balanced against P0.1.
- **Effort:** M per item · **Touches:** `shared` + `server` + `client` · **Contributor entry:** **the flagship contributor path** — a new weapon or vehicle following the documented registry steps.

### P2.5 — Ranked & skill rating
- **Scope:** Skill-rated competitive queue — MMR/rank, placement matches, rank-based matchmaking, season resets feeding P1.3 leaderboards.
- **Effort:** L · **Touches:** `server` + `client` · **Depends on:** **P1.5 (anti-cheat — hard gate)**, P1.1 (accounts), P2.2 (modes), P2.3 (teams for team-ranked).

### P2.6 — Character models & in-game animation overhaul
- **Scope:** Richer player models and animation states (run/strafe/jump/crouch/reload/death) while staying true to the box-mesh, `MeshLambertMaterial`, Minecraft-style aesthetic in [`DESIGN.md`](DESIGN.md) — no spheres, no PBR. Improves readability (what is that enemy *doing*?) as much as looks. Builds on `RemotePlayerManager`.
- **Effort:** L · **Touches:** client · **Contributor entry:** a single new animation state.

---

## P3 — Depth, polish & reach

Longer-horizon and ambitious. Valuable, but only once P0–P2 make the game worth all this.

### P3.1 — Spectator, killcam & replays
- **Scope:** Spectator camera (free-fly + follow-player, no-fire/no-collision), a death killcam, and — further out — match replays. Foundational for competitive integrity, content creation, and the social loop.
- **Effort:** L · **Touches:** `server` + `client`.

### P3.2 — Visual fidelity pass
- **Scope:** Push lighting, weather, VFX, and post-processing further *within* the 8-bit voxel aesthetic — better destruction visuals, richer day/night and weather, instanced-cube particle upgrades. Strictly inside [`DESIGN.md`](DESIGN.md) constraints.
- **Effort:** M–L · **Touches:** client.

### P3.3 — Advanced physics & destruction depth
- **Scope:** Deeper destructible-terrain behavior (structural collapse, smarter falling-block physics) and richer vehicle physics, within the per-frame physics budgets (`MAX_FALLING`, etc.). The destructible world is the headline feature — make it even more satisfying.
- **Effort:** L · **Touches:** `server` (authoritative) + `client`.

### P3.4 — Server regions & global latency
- **Scope:** Evaluate multi-region SpacetimeDB deployment so players outside the primary region get playable latency. Netcode already interpolates and reconciles; this is about geography.
- **Effort:** L · **Touches:** infra + `client` (region select) · maintainer-led.

### P3.5 — Mobile / touch & controller support
- **Scope:** Touch controls and/or gamepad support to expand beyond keyboard-and-mouse desktop browsers. Potentially the single largest audience expansion — and a big lift (input abstraction, UI reflow, perf on mobile GPUs). Flagged as ambitious, not committed.
- **Effort:** L · **Touches:** client (input, UI, perf).

### P3.6 — Community moderation & safety at scale
- **Scope:** In-game player reporting, maintainer moderation tooling, and stronger chat safety building on the existing `chat_moderation` helper. Scales with the player base; pairs with P1.5's groundwork.
- **Effort:** M · **Touches:** `server` + `client`.

---

## Feedback — how this roadmap changes

This is a **living document**, curated by the maintainer with the community in the loop:

- **React & discuss:** the pinned roadmap thread in [Discussions → Announcements](https://github.com/ItzAmirreza/bitwars/discussions). Tell us what's mis-prioritized.
- **Propose features:** open a thread in [Discussions → Ideas](https://github.com/ItzAmirreza/bitwars/discussions/categories/ideas). Strong ideas get promoted onto the roadmap.
- **Build something:** comment on the relevant epic's tracking issue before sinking serious time in (some items have ordering dependencies). Then ship it in small, green-at-every-step PRs per [`CLAUDE.md`](CLAUDE.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Good first issues:** the [`good first issue`](https://github.com/ItzAmirreza/bitwars/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) label (mostly engineering-roadmap items) is the friendliest on-ramp.

Priorities will shift as real-player data (P0.7) and community feedback come in. That's the point — the order is a current best guess, not a contract.
