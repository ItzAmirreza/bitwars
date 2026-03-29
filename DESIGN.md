# DESIGN.md — BitWars Visual Design System

**This file is the single source of truth for all visual design decisions.** Every agent modifying UI, HUD, 3D models, VFX, or adding new visual elements MUST follow these rules. Deviations will break visual consistency.

---

## Core Aesthetic: 8-Bit Pixel Art

BitWars uses a retro 8-bit pixel art aesthetic across all UI and 3D visuals. Everything should feel chunky, crisp, and intentionally low-fi — like a modern game wearing an 8-bit skin.

**Global rendering rules:**
- `image-rendering: pixelated` on body
- `-webkit-font-smoothing: none` on body (no anti-aliasing on text)
- No `border-radius` anywhere — all corners are sharp/square
- No `backdrop-filter: blur()` — no frosted glass effects
- No smooth gradients for backgrounds — use solid colors or hard-edge patterns
- No soft glows or bloom-style `box-shadow` — use hard pixel shadows (offset, no blur)

---

## Color Palette

### Base Colors (CSS Variables — `index.css`)

| Token | Hex | Usage |
|-------|-----|-------|
| `--c-bg` | `#0a0c14` | Page/app background |
| `--c-bg2` | `#0e1018` | Slightly lighter background |
| `--c-surface` | `#12161e` | Panel/card backgrounds |
| `--c-surface2` | `#181c26` | Elevated surfaces |
| `--c-border` | `#1a1e2e` | Default borders |
| `--c-border-bright` | `#2a2e3e` | Highlighted borders |
| `--c-text` | `#e8e8f0` | Primary text |
| `--c-muted` | `#6b7080` | Secondary/dim text |
| `--c-muted2` | `#4a4e5e` | Tertiary/very dim text |

### Accent Colors

| Name | Hex | Usage |
|------|-----|-------|
| Orange | `#ff6b35` | **Primary accent** — buttons, titles, active states, loading bars |
| Cyan | `#00e5ff` | Secondary accent — vehicle info, highlights |
| Pink/Red | `#ff2d78` | Danger — deaths, low health, damage, "YOU DIED" |
| Lime | `#76ff03` | Success — kills, health, player names, online indicators |
| Gold | `#ffd600` | Warnings — system messages, hover states |
| Purple | `#7c4dff` | Decorative accent — used sparingly |
| Amber | `#ff9800` | Ammo warnings, medium alerts |

### Usage Rules
- **Never introduce new accent colors** without updating this file
- Primary actions (PLAY, SAVE) always use orange `#ff6b35`
- Kill counts use lime `#76ff03`, death counts use pink `#ff2d78`
- System/warning messages use gold `#ffd600`
- Vehicle-related UI uses cyan `#00e5ff`
- Panel backgrounds use `rgba(12,16,24,0.88)` (semi-transparent surface)
- Full-width HUD containers must be **transparent** (no background) — only individual panels get backgrounds

---

## Typography

### Fonts (loaded via Google Fonts in `index.html`)

| Variable | Font | Usage |
|----------|------|-------|
| `--font-pixel` | `Press Start 2P` | **All labels, headings, buttons, HUD text** |
| `--font-mono` | `Share Tech Mono` | **Numbers only** — health, ammo, K/D, coordinates, timers |
| `--font-ui` | `Chakra Petch` | Body text fallback (rarely used in current design) |
| `Vazirmatn` | Vazirmatn | Persian/Farsi text in chat (loaded but no CSS variable) |

### Font Size Scale

| Context | Size |
|---------|------|
| Main title (BITWARS) | 28-32px pixel |
| Screen headings | 10-12px pixel |
| HUD panel labels (WEAPON, AMMO, KILLS) | 6-7px pixel |
| HUD small labels | 5-6px pixel |
| Numbers (health, ammo, stats) | 18-28px mono |
| Button text | 8-12px pixel |
| Chat messages | 7px pixel |

### Text Shadow Rules
- **Titles**: `4px 4px 0 #ff6b35, -2px -2px 0 #00e5ff` (dual-color pixel shadow)
- **Section headings**: `2px 2px 0 #000` (simple black offset)
- **HUD labels**: No text shadow, or `1px 1px 0 rgba(0,0,0,0.5)` max
- **NEVER** use blur-based text-shadow (`0 0 Xpx color`) — always hard offset

---

## Borders & Shadows

### Border Rules
- Default panel border: `2px solid #1a1e2e`
- Active/highlighted border: `2px solid #ff6b35` or `2px solid #00e5ff`
- Major panels (settings, loadout overlay): `3px solid #1a1e2e`
- **Never use 1px borders** — minimum is 2px for the pixel aesthetic
- **Never use `border-radius`** — all corners must be sharp

### Shadow Rules
- Panel shadow: `3px 3px 0 rgba(0,0,0,0.3)` (hard offset, no blur)
- Major card shadow: `6px 6px 0 rgba(0,0,0,0.4)`
- Button shadow: `4px 4px 0 rgba(0,0,0,0.5)`
- **Never use blur shadows** (`box-shadow: 0 0 Xpx`) — always offset with 0 blur radius
- Hover: translate element `(-2px, -2px)` and increase shadow to `6px 6px 0`
- Active/pressed: translate `(2px, 2px)` and reduce shadow to `1px 1px 0`

---

## Buttons

### Primary Button (`.btn-primary`)
```
background: #ff6b35
border: 3px solid #000
color: #000
font: var(--font-pixel) 12px
box-shadow: 4px 4px 0 rgba(0,0,0,0.5)
```
- Hover: translate(-2px, -2px), shadow grows
- Active: translate(2px, 2px), shadow shrinks (press-down effect)
- Used for: PLAY, SAVE, primary actions

### Ghost Button (`.btn-ghost`)
```
background: transparent
border: 2px solid var(--c-border-bright)
color: var(--c-muted)
font: var(--font-pixel) 8px
```
- Hover: border and text become `#ffd600`
- Used for: secondary actions, CANCEL, SETTINGS

### HUD Buttons
```
background: rgba(12,16,24,0.85)
border: 2px solid #1a1e2e
font: var(--font-pixel) 7px
```
- Hover: background darkens to `rgba(12,16,24,0.95)`
- Used for: ESC EXIT, SETTINGS, LOADOUT, TEST

---

## HUD Layout Rules

### Bottom HUD
- **The outer container has NO background** — it must be transparent
- Individual panels (health, weapon, ammo, K/D) float independently with their own `rgba(12,16,24,0.88)` backgrounds
- Each panel gets `2px solid #1a1e2e` border + `3px 3px 0 rgba(0,0,0,0.3)` shadow
- Labels in `var(--font-pixel)` at 6-7px
- Numbers in `var(--font-mono)` at 18-28px
- **Never add a full-width background bar** — it obscures the game view

### Top HUD
- Compass bar with `2px solid #1a1e2e` bottom border
- Button row with individual bordered buttons, not a connected bar
- Status displays (ALIVE count, ROUND timer) as small bordered panels

### General HUD Rules
- All HUD elements must be `pointer-events: none` on containers (individual interactive elements opt in)
- Panels should be compact — minimal padding (6-8px), tight gaps (3-4px)
- Use `gap` for spacing, not margins
- Status indicators are square (not rounded dots)

---

## 3D Visual Style

### Player Models (`RemotePlayerManager.ts`)
Minecraft-style blocky characters using **8 box meshes only**:

| Part | Size (w,h,d) | Position | Material |
|------|-------------|----------|----------|
| Head | 0.5, 0.5, 0.5 | 0, 1.65, 0 | `headColor` |
| Visor | 0.44, 0.12, 0.06 | 0, 1.68, -0.26 | `visorColor` (emissive 0.4) |
| Body/Vest | 0.55, 0.65, 0.3 | 0, 1.1, 0 | `vestColor` |
| Chest Stripe | 0.55, 0.06, 0.32 | 0, 1.35, 0 | `accentColor` (emissive 0.15) |
| Left Arm | 0.2, 0.6, 0.2 | -0.38, 1.05, 0 | `bodyColor` |
| Right Arm | 0.2, 0.6, 0.2 | 0.38, 1.05, 0 | `bodyColor` |
| Left Leg | 0.22, 0.5, 0.22 | -0.14, 0.4, 0 | `bodyColor * 0.7` |
| Right Leg | 0.22, 0.5, 0.22 | 0.14, 0.4, 0 | `bodyColor * 0.7` |

- Gun mount at `(0.48, 0.95, -0.15)`, rotation `(-0.08, -0.03, -0.22)`
- **All geometry is `BoxGeometry`** — no cylinders, spheres, or custom shapes
- Materials are `MeshLambertMaterial` — flat shading, no PBR
- Colors come from `characterPresets.ts` per player
- Nametag: canvas-drawn with `Press Start 2P` 24px, green `#76ff03` text on dark background, 3px green border

### Weapon Models — First Person (`WeaponModel.ts`)
Each weapon is **4-5 box meshes maximum**:
- Materials: `MeshLambertMaterial` with dark (`0x1a1a22`), metal (`0x3a3a44`), and one accent color per weapon
- Accent colors use low emissive (0.4 intensity) for a subtle glow
- All parts are `BoxGeometry` — no rounded shapes
- Weapons: Rifle, Shotgun, RPG, Machine Gun, Grenade Launcher

### Weapon Models — Remote Players (`RemotePlayerManager.ts`)
Each held weapon is **3 box meshes** (body + barrel/tube + accent detail):
- Sized proportionally to the player model (~0.3-0.5 length)
- Same material pattern: body, weapon-color, accent with emissive

### Rules for Adding New Weapons/Items
- **Maximum 5 box meshes** per first-person weapon model
- **Maximum 3 box meshes** per remote (third-person) weapon model
- Only `BoxGeometry` — no spheres, cylinders, or imported models
- Only `MeshLambertMaterial` — no standard/physical materials
- One accent color with emissive per weapon for identity
- Colors should be distinct from existing weapons

---

## VFX & Particles (`VFX.ts`)

- Particle material: `MeshBasicMaterial` — no lighting interaction
- Particle geometry: `BoxGeometry(1, 1, 1)` — **cubes, not spheres or planes**
- Instanced rendering via `InstancedMesh` (MAX_PARTICLES = 2000)
- Muzzle flash: small bright cube at barrel, scales down over ~80ms
- Impact particles: 3-6 small cubes spraying outward from hit point

### Rules for Adding New VFX
- Always use the existing `VFX` instanced mesh system — no standalone particle emitters
- Particles must be cubes (`BoxGeometry`)
- Keep particle counts conservative (3-8 per effect)
- Duration: 200-800ms typical, never more than 2s
- Colors: match the source (weapon accent for muzzle flash, block color for debris)

---

## Projectiles (`ProjectileManager.ts`)

- Projectile geometry: `BoxGeometry` — cubes/rectangular prisms
- RPG rockets: small elongated box
- Grenades: small cube
- Trail effects: scaled boxes with decreasing opacity
- **No sphere geometry** for any projectile

---

## Animations & Transitions

### Allowed Animations
- `transition: all 0.1s` — for hover/active state changes (buttons, borders)
- `translate(-2px, -2px)` / `translate(2px, 2px)` — hover lift / press down
- `animation: fade-up 0.5s ease-out` — element entrance
- `animation: title-glow 3s ease-in-out infinite` — title color cycling
- `transition: width 0.15s steps(4)` — stepped loading bars (not smooth)

### Banned Animations
- No `backdrop-filter` transitions
- No smooth opacity fades on backgrounds
- No `transform: scale()` hover effects (except press-down buttons)
- No spring/bounce physics animations
- Loading bars must use `steps()` timing — not smooth `ease` or `linear`

---

## Decorative Elements

### Pixel Divider Bar
A rainbow strip made of adjacent colored blocks used between sections:
```tsx
<div style={{ display: 'flex', height: '4px', gap: '0px' }}>
  {['#ff6b35','#ffd600','#76ff03','#00e5ff','#7c4dff','#ff2d78'].map(c =>
    <div style={{ flex: 1, background: c }} />
  )}
</div>
```

### PixelArtBg Component (`screens/PixelArtBg.tsx`)
Floating pixel art background for menu screens:
- 16 procedural 8x8 pixel patterns (crosshair, explosion, heart, skull, etc.)
- 8 color palettes (warm, cyan, pink, lime, purple, gold, fire, mint)
- Canvas-rendered icons on dark rounded cards drifting upward
- Used in LoginScreen and LobbyScreen

### Corner Brackets (`.corner-brackets`)
16x16px L-shaped corner decorations using CSS `::before`/`::after` with 2px green borders.

---

## Chat & Internationalization

### Chat Styling
- Messages rendered with `fontFamily: 'var(--font-pixel)'` at 7px
- Chat input: `dir="auto"` for automatic RTL detection (Persian, Arabic, Hebrew)
- Sender names in lime `#76ff03`
- System messages in gold `#ffd600`
- Input border-top: `2px solid #ff6b35`, caret color `#ff6b35`

### Persian/RTL Support
- Vazirmatn font loaded via Google Fonts for Persian text rendering
- Chat messages and input use `dir="auto"` — browser detects RTL automatically
- **Never hardcode `direction: ltr`** on text elements that may contain user input
- Vazirmatn renders at the same sizes as the pixel font (browser falls back automatically for non-Latin characters)

---

## Anti-Patterns — Things to NEVER Do

1. **No `border-radius`** — not even `2px`. All corners are square.
2. **No `backdrop-filter: blur()`** — no frosted glass effects.
3. **No smooth gradients** for panel backgrounds — use solid `rgba()` colors.
4. **No blur-based shadows** — `box-shadow` must always be `Xpx Xpx 0` (zero blur).
5. **No blur-based text shadows** — `text-shadow` must always be `Xpx Xpx 0` (zero blur).
6. **No sphere/cylinder geometry** in player models, weapons, or projectiles — only `BoxGeometry`.
7. **No PBR materials** (`MeshStandardMaterial`, `MeshPhysicalMaterial`) for game entities — use `MeshLambertMaterial`.
8. **No anti-aliased font rendering** — body has `-webkit-font-smoothing: none`.
9. **No full-width HUD backgrounds** — bottom HUD container must be transparent, only individual panels have backgrounds.
10. **No `var(--font-mono)` for labels** — use `var(--font-pixel)`. Mono is ONLY for numbers.
11. **No smooth loading bars** — use `steps(N)` CSS timing function.
12. **No new accent colors** without updating the palette in this file.
13. **No `direction: ltr` hardcoding** on user-input text fields.
