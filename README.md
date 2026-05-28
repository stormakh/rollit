# Rollit

Rollit is a Chrome extension that rolls a 3D d20 for quick D&D-style checks.

## Features

- 3D d20 rendered with Three.js
- Difficulty class and modifier controls
- normal, advantage, and disadvantage modes
- themed dice presets
- generated sound effects
- draggable dice with inertia

## Development

```bash
bun install
bun run dev
```

Use the Vite dev server for fast UI iteration.

## Extension Build

Create `.env` first:

```bash
VITE_OPENROUTER_KEY=sk-or-v1-your-key-here
```

```bash
bun run build
```

Load `/dist` as an unpacked extension from `chrome://extensions`.
