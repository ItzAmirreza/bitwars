# BitWars

**A multiplayer 3D voxel FPS with a fully destructible world.**

![license: source-available](https://img.shields.io/badge/license-source--available-orange)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)
&nbsp;[Join our Discord](https://discord.gg/R9HEJBqJAX)

## Play now at [https://bitwars.io](https://bitwars.io)

No download, no account required — it runs in your browser.

<!-- TODO: add gameplay screenshots / GIF here before launch -->

## About

BitWars is a fast, chunky, 8-bit-styled first-person shooter set in a procedurally generated voxel city. Every block in the 750 × 48 × 750 world can be destroyed: blow holes in walls to flank, collapse buildings on entrenched players, or carve your own tunnels. Terrain damage is permanent for the round and synced to every player in real time.

The client is TypeScript + React + Three.js. The server is a Rust module running on [SpacetimeDB](https://spacetimedb.com) — a real-time distributed database that clients connect to over WebSocket. There is no traditional game server process: game state lives in database tables, game logic runs in transactional reducers, and clients subscribe to the tables they care about. The server is the only source of truth — every shot, hit, and destroyed block is validated server-side.

The repo also ships the tooling used to build the game: a headless bot runner whose bots navigate with a neural network, and the Tauri desktop app that trains that network with reinforcement learning against a headless re-implementation of the game world.

## Features

- **6 infantry weapons** — Rifle, Shotgun, RPG, Machine Gun, Grenade Launcher, Sniper — plus throwable grenades
- **4 vehicles** — Helicopter, Fighter Jet, Anti-Air, APC — with **7 vehicle weapons** (Minigun, Rockets, Kinetic Penetrator, Carpet Bomb, CRAM, SAM Missile, Air Missile)
- **Fully destructible terrain** — 750 × 48 × 750 voxels, 16 block types, RLE-compressed chunks, server-authoritative destruction with falling-block physics
- **Procedural world generation** — biomes, road networks, and structures, generated server-side from a seed
- **4 ability pickups** — Health Regen, Double Damage, Speed Boost, Shield
- **Day/night cycle and 5 weather presets** — Clear, Cloudy, Overcast, Rainy, Stormy — all server-driven so every player sees the same sky
- **100% procedural audio** — zero audio files; every sound is synthesized, with ray-traced acoustics computed in a Web Worker (voxel raycasts drive reverb, occlusion, and sound-through-doorway propagation)
- **Neural-network bots** — headless bots that connect as real clients and navigate with a model trained via PPO reinforcement learning
- **Serious netcode** — interpolation buffers for remote entities, tick-aligned client prediction with server reconciliation for vehicles, and server-side validation of fire rate, ammo, range, and movement speed

## Tech stack

| Layer | Technology |
|---|---|
| Client | TypeScript, React 19, Three.js 0.183, Vite 7, Tailwind CSS 4, Zustand — SpacetimeDB TypeScript SDK 2.0 |
| Server | Rust (2021 edition) compiled to WebAssembly, SpacetimeDB 2.0 module |
| Shared config | `shared/game-constants.json` — single source of truth for all game stats, read by both sides |
| Bots | TypeScript headless SpacetimeDB clients + a safetensors navigation model |
| Training | Tauri 2 desktop app, PPO on candle (Rust), React dashboard |
| Tooling | Bun (package manager and runtime — not npm) |

## Repository layout

```
bitwars/
├── client/             Game client (React + Three.js, Vite)
├── server/             SpacetimeDB Rust module (server/spacetimedb/)
├── shared/             game-constants.json — single source of truth for game stats
├── bots/               Headless bot runner (real SpacetimeDB clients)
├── training/           Tauri app for training the bots' neural navigation model
├── benchmarks/         Client performance benchmark snapshots
├── database metrics/   SpacetimeDB dashboard metric exports
├── .github/            CI + deploy workflows, issue/PR templates, CODEOWNERS
├── docs/               REFACTORING.md (code-health roadmap) + LAUNCH_CHECKLIST.md
├── ROADMAP.md          Product roadmap — where the game is going
├── CLAUDE.md           Architecture guide (for developers and AI agents)
└── DESIGN.md           Visual style bible — read before touching any UI
```

## Getting started (development)

You will run the full stack locally: your own SpacetimeDB instance, the game module published to it, and the client dev server. Works on Windows, macOS, and Linux.

### Prerequisites

- [Bun](https://bun.sh) — the project uses Bun, not npm
- [Rust](https://rustup.rs) with the WASM target: `rustup target add wasm32-unknown-unknown`
- [SpacetimeDB CLI](https://spacetimedb.com/install)

### Setup

**1. Clone the repo**

```bash
git clone https://github.com/ItzAmirreza/bitwars.git
cd bitwars
```

**2. Start a local SpacetimeDB instance** (keep this terminal running)

```bash
spacetime start
```

**3. Publish the game module to your local instance** (new terminal, from `server/`)

```bash
cd server
spacetime publish bitwars-local --server local --module-path ./spacetimedb
```

**4. Generate the client bindings** (still from `server/`)

```bash
spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb
```

**5. Configure the client** — copy the example env file and keep its local defaults

```bash
cd ../client
cp .env.example .env.local        # Windows (cmd): copy .env.example .env.local
```

**6. Install and run**

```bash
bun install
bun dev
```

Open the printed Vite URL and you are in your own private BitWars world.

> **Never point your client at the production database for development.** All development happens against your own local instance. Production deploys to the official servers are maintainer-only and handled by CI — contributors never publish anywhere but `--server local`.

After changing server code, re-run steps 3 and 4 (add `--clear-database -y` to the publish command if you changed table schemas). To sanity-check the module compiles without publishing: `cargo build --target wasm32-unknown-unknown --release` from `server/spacetimedb/`.

## Contributing

Contributions are welcome — bug fixes, performance work, new weapons, vehicles, structures, and biomes all have well-trodden registry patterns to follow. Start with:

- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow, local setup, code standards
- [CLA.md](CLA.md) — the contributor license agreement that covers your PRs
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — be excellent to each other
- [CLAUDE.md](CLAUDE.md) and [DESIGN.md](DESIGN.md) — architecture and visual style references
- [ROADMAP.md](ROADMAP.md) (product direction) and [docs/REFACTORING.md](docs/REFACTORING.md) (code-health tasks) — what to work on

One thing to be clear about up front: **BitWars is source-available, not open source.** The code is public so you can study it, learn from it, and improve the game — but the license is not an OSI open-source license. It forbids redistribution, public hosting, and commercial use. The only authorized public instance is [bitwars.io](https://bitwars.io). If that model isn't for you, no hard feelings — you can still play, file issues, and join the discussion.

## Roadmap

Where the game is headed — gameplay, content, and the player experience — lives in [ROADMAP.md](ROADMAP.md), priority-ordered (`P0` → `P3`, no dates). It's a living document: react in the pinned roadmap thread in [Discussions](https://github.com/ItzAmirreza/bitwars/discussions), propose features in the Ideas category, and pick up an epic by commenting on its tracking issue first. Code-health work (file splits, tests, cleanup) has its own track in [docs/REFACTORING.md](docs/REFACTORING.md).

## Community

- **Found a bug?** Open a [GitHub Issue](https://github.com/ItzAmirreza/bitwars/issues)
- **Questions or ideas?** Start a [GitHub Discussion](https://github.com/ItzAmirreza/bitwars/discussions)
- **Chat:** [Join our Discord](https://discord.gg/R9HEJBqJAX)
- **Security issue?** Please report it privately via GitHub Security Advisories ("Report a vulnerability" on the repo's Security tab) — not in a public issue

## License

BitWars is released under the **BitWars Source-Available License v1.0**. In short:

**You can:**

- Read and study the source code
- Clone, build, and run the game locally and privately to evaluate it and develop contributions
- Fork the repo on GitHub to prepare and submit pull requests back to this repository

**You cannot:**

- Host or deploy the game (or any part or derivative of it) publicly, under any name or domain
- Redistribute the code or builds
- Sell it, monetize it, or use it commercially in any way (including ads, donations, or paid access)
- Build derivative games from it
- Use the BitWars name or branding

This summary is not the license. See [LICENSE](LICENSE) for the binding terms.

Copyright © 2026 ItzAmirreza. All rights reserved except as expressly granted in the LICENSE.

## Acknowledgments

- [SpacetimeDB](https://spacetimedb.com) — the database-as-game-server that makes the netcode possible
- [three.js](https://threejs.org) — rendering the voxel world
- [Bun](https://bun.sh) — fast installs, fast dev loop
