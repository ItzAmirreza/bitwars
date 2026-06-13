# Audio assets

All audio in this folder is **CC0 1.0 (Public Domain)** — free to use, modify, and
redistribute, no attribution required. Credits below are courtesy, not obligation.

| Files | Source | License |
|-------|--------|---------|
| `weapons/{rifle,shotgun,sniper,machinegun,minigun}*.mp3` | "The Free Firearm Sound Library" (Prepared SFX Library) — OpenGameArt | CC0 |
| `weapons/rpg.mp3` | "Missile Sound" (missile launch) — OpenGameArt | CC0 |
| `ui/*.mp3` | Kenney — "Interface Sounds" (kenney.nl) | CC0 |
| `combat/explosion*.mp3`, `combat/hitmarker.mp3`, `combat/killconfirm.mp3` | Kenney — "Sci-Fi Sounds" + "Interface Sounds" | CC0 |
| `combat/blockbreak.mp3`, `combat/damage.mp3`, `movement/*.mp3` | Kenney — "Impact Sounds" | CC0 |
| `music/menu.mp3` | "Sci-Fi City — Ambient Loop" (busy_cyberworld) — OpenGameArt | CC0 |

Sources:
- Kenney game assets — https://kenney.nl (CC0)
- OpenGameArt CC0 — https://opengameart.org

Processing: trimmed, downmixed to mono (SFX), and re-encoded to MP3 for browser
`decodeAudioData` compatibility (Safari included). To replace any sound, drop in a new
file with the same name — no code changes needed (see `SampleLibrary.ts` manifest).
