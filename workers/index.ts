import { DurableObject } from "cloudflare:workers";
import type { ClientSignalMessage, PeerInfo, RtcGameMessage } from "../src/game/protocol";
import { sanitizeName, sanitizeRoom } from "../src/game/protocol";

export interface Env {
  ASSETS: Fetcher;
  TANK_ROOMS: DurableObjectNamespace<TankRoom>;
}

interface Client {
  id: string;
  name: string;
  welcomed: boolean;
  windowStartedAt: number;
  messagesInWindow: number;
  gameWindowStartedAt: number;
  gameMessagesInWindow: number;
  helloTimeout: ReturnType<typeof setTimeout>;
}

const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;
const MAX_GAME_MESSAGE_BYTES = 6 * 1024;
const MAX_CLIENT_MESSAGES_PER_SECOND = 90;
const MAX_GAME_MESSAGES_PER_SECOND = 45;
const MAX_ROOM_SIZE = 8;
const MAX_PENDING_CLIENTS = 4;
const MAX_SIGNAL_TARGET_BYTES = 128;
const MAX_BRICK_RESPAWN_MS = 60_000;
const HELLO_TIMEOUT_MS = 5000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/signals$/);

    if (roomMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade.", { status: 426 });
      }

      const room = sanitizeRoom(decodeURIComponent(roomMatch[1] ?? "lobby"));
      const id = env.TANK_ROOMS.idFromName(room);
      return env.TANK_ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export class TankRoom extends DurableObject<Env> {
  private clients = new Map<WebSocket, Client>();

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade.", { status: 426 });
    }

    const clients = [...this.clients.values()];
    const welcomedCount = clients.filter((client) => client.welcomed).length;
    const pendingCount = clients.length - welcomedCount;
    if (welcomedCount >= MAX_ROOM_SIZE || pendingCount >= MAX_PENDING_CLIENTS) {
      return new Response("Room is full.", { status: 429 });
    }

    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];
    const now = Date.now();
    const client: Client = {
      id: crypto.randomUUID(),
      name: "Player",
      welcomed: false,
      windowStartedAt: now,
      messagesInWindow: 0,
      gameWindowStartedAt: now,
      gameMessagesInWindow: 0,
      helloTimeout: setTimeout(() => {
        const pending = this.clients.get(serverSocket);
        if (pending && !pending.welcomed) {
          this.leave(serverSocket);
        }
      }, HELLO_TIMEOUT_MS),
    };
    this.clients.set(serverSocket, client);

    serverSocket.accept();
    serverSocket.addEventListener("message", (event) => this.handleMessage(serverSocket, String(event.data)));
    serverSocket.addEventListener("close", () => this.leave(serverSocket));
    serverSocket.addEventListener("error", () => this.leave(serverSocket));

    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  private handleMessage(socket: WebSocket, payload: string): void {
    const client = this.clients.get(socket);
    if (!client) return;

    if (payload.length > MAX_CLIENT_MESSAGE_BYTES) {
      this.send(socket, { type: "error", message: "Room message is too large." });
      socket.close(1009, "Message too large");
      this.leave(socket);
      return;
    }

    const now = Date.now();
    if (now - client.windowStartedAt > 1000) {
      client.windowStartedAt = now;
      client.messagesInWindow = 0;
    }
    client.messagesInWindow += 1;
    if (client.messagesInWindow > MAX_CLIENT_MESSAGES_PER_SECOND) {
      this.send(socket, { type: "error", message: "Too many room messages." });
      socket.close(1008, "Rate limited");
      this.leave(socket);
      return;
    }

    let rawMessage: unknown;
    try {
      rawMessage = JSON.parse(payload);
    } catch {
      this.send(socket, { type: "error", message: "Invalid JSON." });
      return;
    }

    const message = parseClientSignalMessage(rawMessage);
    if (!message) {
      this.send(socket, { type: "error", message: "Invalid room message." });
      return;
    }

    if (message.type === "hello") {
      client.name = sanitizeName(message.name);
      client.welcomed = true;
      clearTimeout(client.helloTimeout);
      this.send(socket, {
        type: "welcome",
        id: client.id,
        peers: this.peerList(socket),
      });
      this.broadcast({ type: "peer-joined", peer: { id: client.id, name: client.name } }, socket);
      return;
    }

    if (!client.welcomed) {
      this.send(socket, { type: "error", message: "Send hello before room messages." });
      return;
    }

    if (message.type === "signal") {
      const target = this.findWelcomedSocket(message.to);
      if (target) {
        this.send(target, { type: "signal", from: client.id, signal: message.signal });
      }
      return;
    }

    if (message.type === "game") {
      if (!this.canSendGameMessage(socket, client, payload)) {
        return;
      }
      this.broadcast({ type: "room-game", from: client.id, payload: bindGameMessageToClient(client.id, message.payload) }, socket);
      return;
    }

    if (message.type === "chat") {
      const text = message.text.trim().slice(0, 280);
      if (text) {
        this.broadcast({ type: "room-chat", id: client.id, name: client.name, text, at: Date.now() });
      }
    }
  }

  private leave(socket: WebSocket): void {
    const client = this.clients.get(socket);
    this.clients.delete(socket);
    if (client) {
      clearTimeout(client.helloTimeout);
    }
    try {
      socket.close();
    } catch {
      // The socket may already be closed by the runtime.
    }
    if (client?.welcomed) {
      this.broadcast({ type: "peer-left", id: client.id });
    }
  }

  private peerList(exclude: WebSocket): PeerInfo[] {
    return [...this.clients.entries()]
      .filter(([socket, client]) => socket !== exclude && client.welcomed)
      .map(([, client]) => ({ id: client.id, name: client.name }));
  }

  private findWelcomedSocket(id: string): WebSocket | undefined {
    return [...this.clients.entries()].find(([, client]) => client.id === id && client.welcomed)?.[0];
  }

  private canSendGameMessage(socket: WebSocket, client: Client, payload: string): boolean {
    if (payload.length > MAX_GAME_MESSAGE_BYTES) {
      this.send(socket, { type: "error", message: "Game message is too large." });
      return false;
    }

    const now = Date.now();
    if (now - client.gameWindowStartedAt > 1000) {
      client.gameWindowStartedAt = now;
      client.gameMessagesInWindow = 0;
    }
    client.gameMessagesInWindow += 1;
    if (client.gameMessagesInWindow > MAX_GAME_MESSAGES_PER_SECOND) {
      this.send(socket, { type: "error", message: "Too many game messages." });
      return false;
    }

    return true;
  }

  private send(socket: WebSocket, message: unknown): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.leave(socket);
    }
  }

  private broadcast(message: unknown, exclude?: WebSocket): void {
    for (const socket of this.clients.keys()) {
      if (socket !== exclude) {
        this.send(socket, message);
      }
    }
  }
}

function parseClientSignalMessage(value: unknown): ClientSignalMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "hello") {
    return typeof value.name === "string" ? { type: "hello", name: value.name } : null;
  }

  if (value.type === "signal") {
    if (typeof value.to !== "string" || value.to.length > MAX_SIGNAL_TARGET_BYTES || !("signal" in value)) return null;
    return { type: "signal", to: value.to, signal: value.signal };
  }

  if (value.type === "chat") {
    return typeof value.text === "string" ? { type: "chat", text: value.text } : null;
  }

  if (value.type === "game") {
    return isRtcGameMessage(value.payload) ? { type: "game", payload: value.payload } : null;
  }

  return null;
}

function isRtcGameMessage(value: unknown): value is RtcGameMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  if (value.type === "state") {
    return isRecord(value.player) && Array.isArray(value.bullets);
  }

  if (value.type === "brick-hits") {
    return (
      Array.isArray(value.hits) &&
      value.hits.every((hit) => typeof hit === "string") &&
      typeof value.respawnInMs === "number" &&
      Number.isFinite(value.respawnInMs) &&
      value.respawnInMs > 0 &&
      value.respawnInMs <= MAX_BRICK_RESPAWN_MS
    );
  }

  if (value.type === "brick-respawns") {
    return Array.isArray(value.keys) && value.keys.every((key) => typeof key === "string");
  }

  if (value.type === "player-hit") {
    return typeof value.targetId === "string" && typeof value.byId === "string";
  }

  if (value.type === "sync") {
    return (
      isRecord(value.player) &&
      Array.isArray(value.bullets) &&
      Array.isArray(value.destroyedBricks) &&
      value.destroyedBricks.every((key) => typeof key === "string") &&
      Array.isArray(value.brickRespawns) &&
      value.brickRespawns.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]) &&
          entry[1] >= 0,
      )
    );
  }

  return false;
}

function bindGameMessageToClient(clientId: string, message: RtcGameMessage): RtcGameMessage {
  if (message.type === "state" || message.type === "sync") {
    return { ...message, player: { ...message.player, id: clientId } };
  }

  if (message.type === "player-hit") {
    return { ...message, byId: clientId };
  }

  return message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
