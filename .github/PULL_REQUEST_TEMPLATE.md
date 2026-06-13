<!-- Thanks for contributing to BitWars! Please fill in every section that applies.
     New here? Read CONTRIBUTING.md first. -->

## Summary

<!-- What does this PR do, and why? A few sentences is fine. -->

## Linked issue

<!-- Non-trivial changes should start from an issue (see CONTRIBUTING.md). -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature or content (weapon, vehicle, structure, biome, ...)
- [ ] Performance improvement
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] Other (describe in the summary)

## How was this tested?

<!-- Check everything that applies. The build commands are the minimum bar. -->

- [ ] `bun run build` passes in `client/`
- [ ] `cargo build --target wasm32-unknown-unknown --release` passes in `server/spacetimedb/` (required if server code was touched)
- [ ] Client bindings regenerated with `spacetime generate --lang typescript --out-dir ../client/src/module_bindings --module-path ./spacetimedb` and committed (required if tables/reducers changed)
- [ ] Tested in-game against a local SpacetimeDB instance (`spacetime start`) — describe what you tried:

<!-- Describe your in-game testing here. -->

## Screenshots / clips

<!-- Required for any visual change (HUD, models, VFX, lighting, sky/weather).
     Before/after comparisons are ideal. Delete this section if nothing is visual. -->

## Checklist

- [ ] I have read [CLAUDE.md](https://github.com/ItzAmirreza/bitwars/blob/master/CLAUDE.md) (architecture rules) and, for visual changes, [DESIGN.md](https://github.com/ItzAmirreza/bitwars/blob/master/DESIGN.md)
- [ ] No gameplay value is hardcoded that belongs in `shared/game-constants.json`
- [ ] No manual edits to `client/src/module_bindings/` (generated code)
- [ ] No secrets, tokens, or `.env.local` files in the diff
- [ ] The diff is focused on one concern, with no unrelated reformatting

## License agreement (required)

- [ ] **I have read [CLA.md](https://github.com/ItzAmirreza/bitwars/blob/master/CLA.md) and I agree to the BitWars Individual Contributor License Agreement.**
