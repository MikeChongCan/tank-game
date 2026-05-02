# Cloudflare Workers Setup

This project deploys as a Vite static app served by a Cloudflare Worker with a Durable Object for multiplayer room signaling.

## Prerequisites

- Bun installed
- Cloudflare account
- Wrangler authenticated locally

```bash
bun install
bunx wrangler login
```

## Local Development

Run the Worker/Durable Object server:

```bash
bun run worker:dev
```

Run the Vite client in another terminal:

```bash
bun run dev
```

Open two browser tabs:

```text
http://127.0.0.1:5173/?room=lobby&name=Alice
http://127.0.0.1:5173/?room=lobby&name=Bob
```

The client auto-selects English or Simplified Chinese from the browser language. For QA, append `&lang=en` or `&lang=zh-CN`.

In local Vite development, the client automatically connects signaling to:

```text
ws://127.0.0.1:8787/api/rooms/<room>/signals
```

## Deploy

Build the Vite app:

```bash
bun run build
```

Dry-run the Worker deployment:

```bash
bun run worker:dry-run
```

Deploy:

```bash
bun run deploy
```

Wrangler reads `wrangler.toml`, which configures:

- `workers/index.ts` as the Worker entry
- `dist/` as the static asset directory
- `TANK_ROOMS` as the Durable Object binding
- `TankRoom` as the Durable Object class

## Multiplayer Networking

The Worker is used for:

- joining rooms
- peer discovery
- WebRTC offer/answer/ICE signaling
- chat
- fallback game-state relay when WebRTC DataChannels are not open

When WebRTC connects successfully, game-state traffic uses peer-to-peer DataChannels. If WebRTC fails, the Worker relay keeps the room playable.

## Production Notes

The current WebRTC config uses public STUN only. For more reliable production networking, add a TURN service in `src/net/webrtc.ts`:

```ts
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:your-turn-host:3478",
      username: "your-username",
      credential: "your-credential",
    },
  ],
};
```

Do not commit private TURN credentials. Use a secure runtime configuration path if you add real credentials.

## Validation

Before deploying changes:

```bash
bun run test
bun run check
bun run build
bun run worker:dry-run
```
