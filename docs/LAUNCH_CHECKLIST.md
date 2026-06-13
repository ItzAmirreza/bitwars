# Source-Available Launch Checklist

Maintainer-only checklist for flipping the BitWars repository public. Work through it **in order** — the announcement is the last box, and nothing gets announced while any box above it is unchecked.

Facts below (file paths, line numbers, workflow contents) were verified against the working tree on 2026-06-12. Re-verify line numbers if files have changed since.

> Code-health work that contributors can pick up after launch lives in [REFACTORING.md](REFACTORING.md). Two of its P0 items (PR CI, deploy gating) are duplicated here because they are launch blockers, not just hygiene.

---

## 0. The hard blocker

- [ ] **Fix the username-based admin backdoor and redeploy — before the repo goes public, no exceptions.**
  `server/spacetimedb/src/admin.rs:11` hardcodes `const ADMIN_USERNAME: &str = "amir"` and `is_admin()` is a case-insensitive string match on the display name. Combined with `server/spacetimedb/src/player.rs` (~lines 28–37), which deliberately releases display names held by **offline** profiles, anyone reading the public source can wait for the maintainer to log off, claim the name `amir`, and get full admin on the production bitwars.io database (`/tp`, `/kill`, `/killall`, `/god`, `/ammo`, `/spawn`, `/weather`, `/time`, `/announce`, `/respawnall`, …).
  **Action:** replace username matching with Identity-based gating — e.g. a private (non-`public`) admin table keyed by SpacetimeDB `Identity`, populated out-of-band — then run the full deploy cycle from `CLAUDE.md` (cargo build → `spacetime publish` → regenerate bindings → client build) so the fix is **live in production** before the source is visible.

## 1. Legal

- [ ] Confirm the launch legal docs are committed at repo root: `LICENSE` (the "BitWars Source-Available License", version 1.0 — plain filename, no extension) and `CLA.md`. (As of 2026-06-12 neither exists in the tree yet; they are being authored as part of launch prep.)
- [ ] **Lawyer review of `LICENSE` and `CLA.md`.** In particular: resolve the `[JURISDICTION]` placeholder with a real governing-law choice; confirm the three narrow grants (view/study, local private builds for evaluation and contribution, GitHub-internal forks for PRs), the prohibition set (no public hosting under any name or domain, no redistribution, no derivatives beyond contribution PRs, no commercial use including ads/donations/paid access, no sublicensing, no trademark rights), automatic termination on breach, the all-caps warranty disclaimer and limitation of liability, and the clause acknowledging GitHub's ToS fork right while restricting use/hosting/distribution of forks.
- [ ] **Wording sweep: "source-available", never "open source".** Check every public-facing doc (README, CONTRIBUTING, SECURITY, code of conduct, this repo's GitHub description, and any announcement drafts). Where useful, state explicitly that the project is *not* OSI open source but the code is public and contributions are welcome. Quick check: `git grep -in "open source" -- '*.md'` and review each hit.
- [ ] Confirm all docs name **https://bitwars.io** as the only authorized public instance, and that nothing implies self-hosting is permitted.

## 2. Secrets and safety

Findings from the full secrets scan (all 280 tracked files audited 2026-06-12), each with its disposition:

- [ ] **`server/spacetimedb/src/admin.rs` — blocker.** Covered by section 0 above; do not check this section off until that fix is deployed.
- [ ] **`.gitignore` — add `.context/`.** The bot auth-token directory `.context/bot-tokens/` (created by `Dockerfile.bots:16-17`, written by `bots/src/bot.ts` token persistence) is not ignored by git. No tokens are tracked today, but one careless `git add .` after running bots locally would commit live SpacetimeDB auth tokens. `.dockerignore` already excludes `.context`; the root `.gitignore` must too.
- [ ] **`bots/README.md` — remove leaked local paths and stale commands.** Lines 12 and 57 contain absolute paths from a previous machine (`/Users/amir/conductor/workspaces/bitwars/...`) that leak a local username and internal tooling, and are broken links for everyone else — replace with repo-relative links. While in there: the doc says `npm run ...` throughout; the project uses **bun**.
- [ ] **`bots/src/main.ts` (lines ~22–29) + `Dockerfile.bots` (lines 23–24) — flip the bot default target to local.** The bot runner currently defaults to the **production** database (`wss://maincloud.spacetimedb.com`, module `bitwars`) when no `--uri`/`--module` flags or env vars are set. Not a credential, but a contributor running the bots with no args floods production with 10 bots — directly against the policy that contributors only ever touch their own local instance. Make the default `ws://127.0.0.1:3000` / `bitwars-local` (matching the existing `bots:local` script in `client/package.json`) and make maincloud explicit opt-in.
- [ ] **Hardcoded Discord invite — reconcile.** `https://discord.gg/R9HEJBqJAX` is hardcoded in `client/src/screens/LoginScreen.tsx:796`, `client/src/screens/LobbyScreen.tsx:640`, and `client/src/screens/PrivacyPolicy.tsx:162`. It already ships in the public client at bitwars.io, so it is not a secret — but the launch docs assume the community Discord "does not exist yet". Decide: is this invite the permanent public server? If yes, use it consistently everywhere (see section 4); if not, rotate/remove it from the client before launch.
- [ ] **`.github/workflows/deploy-server.yml` — verified clean, settings follow-up.** The SpacetimeDB token appears only as `${{ secrets.SPACETIMEDB_TOKEN }}` (line 44), never inlined. Triggers are `push` to `master` (paths-filtered) and `workflow_dispatch` — there is **no** `pull_request` or `pull_request_target`, so fork PRs cannot run it, and GitHub does not pass repo secrets to fork PRs by default. Action items: keep it that way (re-check before launch that no `pull_request_target` was introduced), enable branch protection so only the maintainer can push/dispatch (section 3), and gate the deploy itself (section 5) — it currently runs `spacetime publish ... --clear-database` on **every** master push touching `server/**` or `shared/game-constants.json`, i.e. merging an external server PR would wipe the production database.
- [ ] **`benchmarks/perf-master.json` + `benchmarks/perf-ring.json` — accept as public or remove.** They embed the benchmark machine's fingerprint (user agent, `Linux x86_64`, `NVIDIA GeForce RTX 3070`, viewport, core count) plus internal branch names and commit hashes. No credentials or player data — purely informational. Decide and check off.
- [ ] **`database metrics/` (14 CSVs) — accept as public or remove.** Pure time/value series exported from the SpacetimeDB dashboard on 2026-03-17 (TPS, connected clients, billed bytes/CPU). No identities, IPs, or player data, but they reveal production usage and billing levels. If kept, rename the directory — it contains a space ([REFACTORING.md](REFACTORING.md) P0.3).
- [ ] **`bots/gamer_usernames.txt` — accept as public.** Verified: a synthetic, procedurally generated list of 4,999 bot names — not real player data. No action beyond this acknowledgment.
- [ ] **Confirm no env files are tracked.** `git ls-files | grep -i "\.env"` must return nothing (verified clean on 2026-06-12; `.gitignore` covers `*.env`, `*.env.*`, `*.local`). Confirm your local `.env.local` (used to point the client at a local SpacetimeDB) is untracked.
- [ ] **Enable GitHub secret scanning and push protection** (Settings → Code security) the moment the repo is public, so any future token paste is blocked at push time.
- [ ] **Final sweep on the exact launch commit.** After all of the above land, re-run a credentials scan (token/key/JWT patterns, absolute local paths, tracked env files) on the commit that will go public. The 2026-06-12 audit was clean apart from the findings listed here — keep it that way.

## 3. GitHub repository settings

- [ ] Add repo description ("Multiplayer 3D voxel FPS — TypeScript/React/Three.js client, Rust/SpacetimeDB server"), website **https://bitwars.io**, and topics (e.g. `voxel`, `fps`, `multiplayer`, `threejs`, `spacetimedb`, `rust`, `typescript`, `game`).
- [ ] Enable **Discussions** (questions and ideas go there; Issues stay for bugs and roadmap tasks).
- [ ] Enable **private vulnerability reporting** (Settings → Code security → "Report a vulnerability"), since the security policy directs reports to GitHub Security Advisories.
- [ ] **Branch protection on `master`:** require pull requests and passing CI checks before merge; restrict who can push.
  ⚠️ Caveat: `deploy-server.yml` currently pushes regenerated bindings and the build manifest **directly to `master`** as `github-actions[bot]` (its final step). Strict branch protection will break that auto-commit — either grant the Actions bot a bypass, or rework the workflow to open a PR for deploy artifacts. Decide deliberately; don't discover it mid-deploy.
- [ ] Disable the **wiki** (unused; docs live in the repo) and disable **Projects** if unused.
- [ ] Set **squash merge** as the default (and ideally only) merge method, so contributor history stays clean.
- [ ] Confirm fork-PR workflow approval is set to "Require approval for first-time contributors" or stricter (Settings → Actions), so CI on fork PRs runs only after a maintainer look.

## 4. Community

- [ ] **Create the Discord server** (or bless the existing `discord.gg/R9HEJBqJAX` invite already shipped in the client — see the reconcile item in section 2). Generate a permanent invite.
- [ ] **Replace every Discord placeholder.** The launch docs (README, CONTRIBUTING, and any other docs written for launch) use the literal text `[Discord invite - coming soon]`. Find every occurrence with:
  ```bash
  git grep -rF "[Discord invite - coming soon]"
  ```
  and replace each with the real invite. The same invite must match the three hardcoded client locations (`LoginScreen.tsx:796`, `LobbyScreen.tsx:640`, `PrivacyPolicy.tsx:162`).
- [ ] **Add real media to the README.** The README's screenshots/media section ships with placeholders at launch-prep time — capture 2–3 in-game screenshots and a short gameplay GIF (the 8-bit voxel aesthetic is the project's best pitch) and embed them before announcing.
- [ ] Seed Discussions with a welcome/introductions post and a "what to work on" post linking to [REFACTORING.md](REFACTORING.md) and the good-first-issue items.
- [ ] Create a handful of starter issues from REFACTORING.md items marked **GFI**, labeled `good first issue`.

## 5. CI

- [x] Land `.github/workflows/ci.yml` ([REFACTORING.md](REFACTORING.md) P0.1) — **done.** Runs on every PR and push: client `bun install --frozen-lockfile && bun run lint && bun run build` and server `cargo build --target wasm32-unknown-unknown --release`, with no secret access (safe for fork PRs).
- [ ] Extend `ci.yml` to also run `cargo test` (server) and `bun run bots:typecheck` — deferred from the initial CI land; add once both are reliably green.
- [ ] **Gate the production deploy.** Change `deploy-server.yml` so publishing to maincloud happens only on manual `workflow_dispatch` (or a release tag) — never automatically on a merged PR that touches `server/**`. The `--clear-database` flag makes the current on-push trigger a production-wipe hazard once external PRs merge.
- [ ] **Prove it on a real PR before announcing:** open a test PR from a fork (not a branch) and confirm (a) `ci.yml` runs and passes, (b) `deploy-server.yml` does **not** run, and (c) the workflow run shows no access to `SPACETIMEDB_TOKEN`.
- [ ] Make the CI checks required in branch protection (section 3) once they're green.

## 6. Announcement

Only after **every** box above is checked:

- [ ] Final read of the announcement copy: it says **source-available** (never "open source"), names **https://bitwars.io** as the only place to play, links the canonical repo **https://github.com/ItzAmirreza/bitwars**, and points contributors at CONTRIBUTING and the roadmap.
- [ ] Flip the repository to **public**.
- [ ] Immediately verify post-flip: secret scanning + push protection active (section 2), Discussions live, "Report a vulnerability" button visible on the Security tab, CI badge green.
- [ ] Announce (Discord, socials, wherever) — and watch Issues/Discussions closely for the first week.
