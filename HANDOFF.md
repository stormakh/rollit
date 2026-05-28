# Rollit Handoff

## Project

Rollit is a Manifest V3 Chrome extension that rolls a 3D d20 for quick D&D-style checks.

Public repo:

```text
https://github.com/stormakh/rollit
```

Local repo:

```text
/Users/santi/code/rollit
```

Clean clone:

```text
/Users/santi/code/rollit-clone
```

## Current State

Implemented:

- Chrome extension popup via Vite build output in `dist/`
- Three.js 3D d20 using `IcosahedronGeometry`
- face-aligned dice numbers
- black and gold default dice preset
- extra thick gold edge geometry for black/gold preset
- draggable dice with swipe inertia
- roll animation with damped spin and final face alignment
- normal, advantage, and disadvantage roll modes
- DC and modifier settings
- WebAudio sound presets
- magical dark UI with pointer-proximity glow
- settings drawer

Latest public commit before this handoff:

```text
9ac25d1 Implement 3D dice roller
```

## Commands

Install:

```bash
bun install
```

Dev UI preview:

```bash
bun run dev
```

Extension build:

```bash
bun run build
```

Chrome test:

1. Run `bun run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked.
5. Select `/Users/santi/code/rollit/dist`.
6. After changes, rebuild and reload extension card.

## File Map

```text
index.html              Popup markup
src/main.js             Three.js dice, roll state, sounds, controls
src/styles.css          Popup UI, animations, theme
public/manifest.json    MV3 extension manifest
vite.config.js          Vite config with extension-safe relative asset paths
package.json            Bun/Vite/Three project config
```

## Core Implementation Notes

`src/main.js` owns almost everything. Key areas:

- DOM bindings at top.
- Three.js scene setup: renderer, camera, `IcosahedronGeometry`, material, edges.
- `createFaceNumbers()` places one number label per face.
- `getLandingQuaternion(number)` maps selected d20 result to a face pointed at camera.
- `roll()` chooses result first, then starts animation and sounds.
- `animate()` handles roll physics, drag inertia, idle float, and render loop.
- WebAudio functions generate roll ticks, hover sound, and pass/fail sounds.
- Drag handlers on `canvas` rotate dice and preserve swipe inertia.

Important design choice:

- Random result uses `crypto.getRandomValues()`.
- Dice animation then lands on matching face.
- This gives fair randomness while keeping visual result consistent.

## UX Decisions

- Main roll control starts as centered `Roll`.
- After roll, same control shows result number + `Success` or `Fail`.
- Settings are hidden behind gear toggle.
- Black & Gold is default.
- Advantage/disadvantage shows both rolls in hint text.
- Dice can be dragged when not rolling.

## Build Size

Last measured build:

```text
dist/index.html                   2.56 kB │ gzip 0.80 kB
dist/assets/index-7P34Ehf5.css    6.03 kB │ gzip 2.01 kB
dist/assets/index-aXozepme.js   475.41 kB │ gzip 121.47 kB
```

Most JS weight comes from `three`.

## Known Risks

- `src/main.js` is large and should be split before adding many features.
- There are no automated tests.
- Extension popup needs manual reload after each build.
- Dice face numbering is generated sequentially from geometry faces, not real-world opposite-face d20 numbering.
- Final face alignment is visual, not physics-engine based.
- WebAudio sounds are synthesized, not asset-based.

## Good Next Steps

1. Split `src/main.js` into modules:
   - `dice-scene.js`
   - `roll-engine.js`
   - `audio.js`
   - `settings.js`
2. Persist user settings with `chrome.storage.sync`.
3. Add extension icons and publish metadata.
4. Add keyboard shortcut support.
5. Add real d20 face numbering layout.
6. Add reduced-motion and mute toggles.
7. Improve extension DX with watch/reload helper.
8. Add screenshot/browser smoke test.

## Git History Intent

Repo history was intentionally made to look like project started cleanly today:

```text
1eaa495 Scaffold Rollit extension project
3fe3add Add Chrome extension shell
9ac25d1 Implement 3D dice roller
```

Keep future commits similarly small and product-shaped.
