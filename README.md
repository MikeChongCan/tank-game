# 坦克大战

A Bun-powered Vite/React multiplayer tank game inspired by Super Tank / Battle City.

## What is included

- Canvas tank arena with deterministic room maps, brick destruction, steel walls, movement, shooting, scoring, and respawn.
- Gamer-name and room-code join flow, with no authentication.
- Browser-language localization with PO catalogs for English and Simplified Chinese.
- Cloudflare Worker + Durable Object room server for WebSocket signaling and room chat.
- WebRTC DataChannel mesh for live player state, bullets, brick hits, and join-in-progress sync.

## Local development

Install:

```bash
bun install
```

Run the Worker signaling server:

```bash
bun run worker:dev
```

Run the Vite client in another terminal:

```bash
bun run dev
```

Open two browser windows at the Vite URL with the same room, for example:

```text
http://127.0.0.1:5173/?room=lobby&name=Alice
http://127.0.0.1:5173/?room=lobby&name=Bob
```

The UI follows the browser language. Add `lang=en` or `lang=zh-CN` to the URL to force a locale during QA.

## Checks

```bash
bun run test
bun run check
bun run build
bun run worker:dry-run
```
