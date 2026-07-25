# Design preview harness

Renders game models in isolation to a PNG, without booting the game. A full
contact sheet of every weapon, character preset and voxel fixture takes about
two seconds; doing the same by logging in, loading a match and flying the camera
around takes minutes and can't be scripted.

It imports the shipping builders (`WeaponModel`, `RemotePlayerModel`,
`chunkMeshing` + `createChunkMaterial`) and the shared light rig
(`game/lightingRig`), so a shot is the real thing under the real lighting — not
a lookalike that drifts as the game changes.

## Use

Needs the dev server running (`bun dev`).

```bash
bun run shot --all                                    # every subject
bun run shot --subject character                      # one contact sheet
bun run shot --subject voxel --variants flat,pit      # specific variants
bun run shot --subject fpweapon --yaws 0,90,180,270   # turntable of one variant
bun run shot --subject character --view front --cell 600 --scale 2
```

Output lands in `client/.preview-shots/` (gitignored). Open
`http://localhost:5173/preview.html` in a browser for the subject index and to
poke at parameters interactively.

| Flag | Meaning |
|---|---|
| `--subject` | Subject id — see the index page |
| `--variants` | Comma-separated variant ids, or `all` |
| `--view` | `front` `back` `side` `threequarter` `top` |
| `--yaws` | Degrees; renders the *first* variant from each angle |
| `--cols` `--cell` `--zoom` | Grid layout and framing |
| `--ground` | `1`/`0` to force the shadow-catching ground plate |
| `--bg` | Backdrop hex, e.g. `--bg 202024` |
| `--scale` | Device pixel ratio (2 for detail work) |
| `--out` `--outdir` | Output path / directory |

## Adding a subject

One file per subject in `subjects/`, registered in `subjects/index.ts` — the
same registry rule the rest of the repo follows. Implement `listVariants()` and
`build(variantId)`; the stage handles camera framing from the bounding box, so
there is nothing to hand-position.

## What it can't tell you

Static frames only. Recoil timing, movement feel, weapon handling and anything
else that lives in motion still needs the real game. Rendering goes through
SwiftShader in headless Chrome, so it is deterministic across machines but is
**not** a performance measurement.
