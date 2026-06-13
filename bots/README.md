# Bots

Initial headless bot runner for BitWars.

Current scope:
- infantry only
- real SpacetimeDB clients, not fake render puppets
- humanized roam / target / burst-fire loop
- voxel-aware ground sampling and line-of-sight checks
- bot auth tokens persisted in `.context/bot-tokens/` so reruns can reclaim the same profiles

Run from [`client/package.json`](../client/package.json):

```bash
cd client
bun run bots -- --count 10
```

`bots` defaults to your local instance (`ws://127.0.0.1:3000` / `bitwars-local`) unless you pass `--uri` / `--module` or set env vars. Targeting maincloud is an explicit opt-in — never point the bots at production unless you are the maintainer.

For Bun-only production environments like Coolify, use the Bun-native runtime command so the process does not depend on the `tsx` dev dependency:

```bash
cd client
bun run bots:runtime -- --count 10
```

Use `bots:local` for the local dev database:

```bash
cd client
bun dev
bun run bots:local -- --count 10
```

If you want a completely fresh local bot roster, clear and republish the local DB:

```bash
./server/scripts/publish-local.sh
```

Useful flags:

```bash
bun run bots -- --count 10 --prefix BOT --uri wss://maincloud.spacetimedb.com --module bitwars
```

Environment variable overrides:
- `BOT_COUNT`
- `BOT_PREFIX`
- `BOT_TICK_MS`
- `SPACETIMEDB_URI`
- `SPACETIMEDB_MODULE`

Notes:
- This first version uses the rifle path only. It is meant to establish the real-client bot architecture before adding richer weapon, cover, and vehicle behavior.
- The bot runner reuses the generated client bindings in [`client/src/module_bindings`](../client/src/module_bindings).
