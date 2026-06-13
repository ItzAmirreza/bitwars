# Contributing to BitWars

Thanks for wanting to make BitWars better. Before anything else, the deal in one paragraph: BitWars is **source-available, not open source**. The code is public so you can read it, study it, run it locally, and improve it — but the [LICENSE](LICENSE) reserves all other rights. Under the license, GitHub forks exist solely to prepare pull requests back to the [canonical repository](https://github.com/ItzAmirreza/bitwars), contributions are accepted under the Contributor License Agreement in [CLA.md](CLA.md), and the only authorized public deployment of the game is [bitwars.io](https://bitwars.io). If that works for you, welcome aboard.

## Ways to help

- **Code** — gameplay, netcode, rendering, audio, tooling. Start with the workflow below.
- **Bug reports** — open a [GitHub Issue](https://github.com/ItzAmirreza/bitwars/issues) using the bug report form.
- **Ideas and questions** — [GitHub Discussions](https://github.com/ItzAmirreza/bitwars/discussions).
- **Playtesting** — play at [bitwars.io](https://bitwars.io) and report what breaks or feels wrong.
- **Docs** — fixing inaccuracies, improving setup instructions, clarifying architecture notes.

Community chat: Discord — [Join our Discord](https://discord.gg/R9HEJBqJAX).

## Development setup

Contributors are on Windows, macOS, and Linux — all three work. You need three tools:

| Tool | Used for | Install |
|---|---|---|
| [Bun](https://bun.sh) | Client package manager and scripts (this project uses bun, **not npm**) | bun.sh install instructions for your OS |
| [Rust](https://rustup.rs) (stable) | Building the SpacetimeDB server module to WASM | Install via rustup, then `rustup target add wasm32-unknown-unknown` |
| [SpacetimeDB CLI](https://spacetimedb.com/install) | Running your own local game database | macOS/Linux: `curl -sSf https://install.spacetimedb.com \| sh` — Windows: see the install page |

### 1. Clone and install client dependencies

```bash
git clone https://github.com/ItzAmirreza/bitwars.git
cd bitwars/client
bun install
```

### 2. Start your own local SpacetimeDB instance

```bash
spacetime start
```

Leave this running in its own terminal. It listens on `127.0.0.1:3000`.

> **Important:** All development happens against your own local instance. Never publish to, or point your client at, the production `bitwars` database — production deploys are maintainer-only and handled by CI.

### 3. Build and publish the server module locally

From the `server/` directory:

```bash
spacetime publish bitwars-local --server local --module-path ./spacetimedb
```

Add `--clear-database -y` when your change alters table schemas (it wipes only your local database).

### 4. Point the client at your local instance

Copy `client/.env.example` to `client/.env.local`. It contains:

```bash
VITE_SPACETIMEDB_URI=ws://localhost:3000
VITE_MODULE_NAME=bitwars-local
```

Without a `.env.local`, the dev client connects to the production database — don't develop that way. `.env.local` is gitignored; never commit it.

### 5. Run the client

```bash
cd client
bun dev
```

Open the Vite dev server URL it prints, and you should be in your own private BitWars.

### 6. Verify your setup

Before writing any code, confirm both sides build cleanly:

```bash
# Client (in client/) — runs tsc + vite build
bun run build

# Server (in server/spacetimedb/)
cargo build --target wasm32-unknown-unknown --release
```

`bun run lint` (in `client/`) runs ESLint and should also pass.

### After changing server tables or reducers

Regenerate the TypeScript client bindings (from `server/`):

```bash
spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb
```

The bindings are committed to the repo — include the regenerated files in your PR when the schema changed, and never edit them by hand.

### Optional: headless bots

To populate your local world with bots, run `bun run bots:local` from `client/` (it targets `ws://127.0.0.1:3000` / `bitwars-local`). See the `bots/` directory for details.

### Optional: admin commands in local dev

Admin chat commands (`/weather`, `/time`, `/spawn`, `/god`, …) are **off by default** — production has no in-game admin. To enable them locally, build the server with the `dev` feature (which makes every player an admin) and publish that build:

```bash
cd server/spacetimedb
cargo build --features dev --target wasm32-unknown-unknown --release
cd ..
spacetime publish bitwars-local --server local -b spacetimedb/target/wasm32-unknown-unknown/release/server.wasm --module-path ./spacetimedb
```

Never build with `--features dev` for anything that touches production — production must always be built without it.

## Before you write code

Read these first — they will save you a rejected PR:

- **[CLAUDE.md](CLAUDE.md)** — architecture rules, patterns, and the feature checklist.
- **[DESIGN.md](DESIGN.md)** — the visual style bible. Mandatory before touching anything visual (HUD, models, VFX).
- **[server/CLAUDE.md](server/CLAUDE.md)** — SpacetimeDB-specific rules for the Rust module.

The five rules that matter most:

1. **The server is the only source of truth.** Health, ammo, blocks, positions — the server decides what happened; the client only renders it (with prediction that reconciles to server state).
2. **Shared values live in `shared/game-constants.json`.** Any number used by both client and server (damage, speed, world size) is edited there, never hardcoded in two places.
3. **New content goes through registries.** Weapons, vehicles, structures, and biomes are added as new files registered in a central list — never as `if (type === 3)` chains.
4. **Anything all players must see needs a server event table** (with a scheduled cleanup reducer). Client-only effects that other players can't see will not be merged.
5. **Keep files under ~500 lines** and one responsibility per file. If your change pushes a file past that, split it.

## Contribution workflow

1. **Start from an issue.** For anything non-trivial, find or open an issue first and say you'd like to work on it — this avoids wasted effort on changes that won't be accepted. Big or fuzzy ideas go to Discussions first.
2. **Fork the repository on GitHub.** Per the LICENSE, forks exist to prepare pull requests — not to host or distribute the game.
3. **Branch from `master`**, one small focused branch per change.
4. **Commit in clear, imperative messages** ("Fix shotgun spread validation", not "fixed stuff"), keeping commits scoped and readable.
5. **Open a pull request** against `master` using the PR template, filling in every section that applies.
6. **Automated checks must pass** before review.
7. **Maintainer review.** The maintainer ([@ItzAmirreza](https://github.com/ItzAmirreza)) reviews all PRs; expect a round or two of feedback.

## Pull request guidelines

- **Keep diffs small** — one concern per PR. Two unrelated fixes are two PRs.
- **Visual changes need screenshots or clips** (before/after where it makes sense).
- **Never edit `client/src/module_bindings/`** by hand — it is generated; regenerate it instead.
- **Never commit secrets**, tokens, or your `.env.local`.
- **Follow DESIGN.md** for anything visible: pixel fonts, hard shadows, square corners, `BoxGeometry` — no rounded corners, no PBR, no spheres.
- **Don't reformat code you aren't changing** — mass reformatting drowns out the actual diff.

## Contributor License Agreement

Your first PR must check the CLA box in the pull request template: *"I have read CLA.md and I agree to the BitWars Individual Contributor License Agreement."* Per [CLA.md](CLA.md), checking that box accepts the agreement for that contribution and all future ones. The short version: you keep the copyright to your work and grant the project a broad license to use it — read the full text, it's intentionally short.

## What will not be merged

To save everyone time, these are off the table:

- Changes to the LICENSE, CLA, or anything that weakens the source-available licensing model.
- Monetization of any kind — ads, payments, donation prompts, paid access.
- Anything that enables or encourages hosting the game outside the official [bitwars.io](https://bitwars.io) instance (rebranding hooks, instance browsers, deployment tooling for third parties).
- Manual edits to the generated bindings in `client/src/module_bindings/`.
- Mass reformatting, license-header sweeps, or other drive-by style churn.

## Security issues

Found a vulnerability? **Do not open a public issue.** Report it privately via GitHub Security Advisories — use **"Report a vulnerability"** on the repository's [Security tab](https://github.com/ItzAmirreza/bitwars/security).

## Questions?

Ask in [GitHub Discussions](https://github.com/ItzAmirreza/bitwars/discussions), or on Discord: [Join our Discord](https://discord.gg/R9HEJBqJAX). See you in game.
