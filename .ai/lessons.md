# Lessons

## Audio: "make it sound nice" ≠ tune the synthesis
- **Correction (2026-06-13):** I spent a full pass tuning procedural Web Audio synthesis
  (oscillator freqs, envelopes, a master saturator) to make sounds "nicer." The user's actual
  complaint was that everything "sounds like bits" — i.e. *synthetic*. No amount of tweaking
  oscillators removes that; procedural synthesis fundamentally sounds synthetic.
- **Pattern:** When a user says sounds are "annoying / cheap / like bits / want a real overhaul,"
  the lever is **real sample files**, not better synthesis. Confirm samples are allowed, then build
  a sample pipeline and source assets. Ask "samples vs procedural?" *early*, before tuning synth.
- **Also:** don't add feedback sounds the user didn't ask for (I added a per-block-hit "tick" that
  they found annoying). New always-on cues need a clear reason; default to fewer sounds.
- **Asset sourcing that works here:** network + `curl` available via `dangerouslyDisableSandbox`;
  WebFetch extracts download URLs. CC0 sources used: Kenney (kenney.nl, direct zip URLs via the
  asset page), OpenGameArt (raw `/sites/default/files/...` URLs; firearm library is a `.7z` that
  macOS `bsdtar` reads natively). `ffmpeg` here lacks libvorbis → encode to **MP3** (Safari-safe;
  OGG Vorbis fails in Safari's `decodeAudioData`). Downmix SFX to mono (correct for 3D panners).
