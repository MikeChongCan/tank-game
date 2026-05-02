import type { ChatMessage, ClientSignalMessage, RtcGameMessage, ServerSignalMessage } from "../game/protocol";
import { sanitizeName, sanitizeRoom } from "../game/protocol";

type Handler = (message: ServerSignalMessage) => void;

export function getSignalingUrl(roomInput: string, base = globalThis.location?.href): string {
  const room = sanitizeRoom(roomInput);
  const pageUrl = new URL(base ?? "http://127.0.0.1:5173");
  const configured = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_SIGNALING_URL;

  if (configured) {
    const endpoint = new URL(configured);
    endpoint.pathname = `/api/rooms/${room}/signals`;
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    return endpoint.toString();
  }

  const localVite = pageUrl.hostname === "127.0.0.1" || pageUrl.hostname === "localhost";
  const endpoint = new URL(localVite ? "http://127.0.0.1:8787" : pageUrl.origin);
  endpoint.pathname = `/api/rooms/${room}/signals`;
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  return endpoint.toString();
}

export class SignalingRoom {
  private socket: WebSocket | null = null;
  private handler: Handler;
  private reconnectTimer: number | null = null;
  private closed = false;

  readonly room: string;
  readonly name: string;

  constructor(room: string, name: string, handler: Handler) {
    this.room = sanitizeRoom(room);
    this.name = sanitizeName(name);
    this.handler = handler;
  }

  connect(): void {
    this.closed = false;
    const socket = new WebSocket(getSignalingUrl(this.room));
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.send({ type: "hello", name: this.name });
    });

    socket.addEventListener("message", (event) => {
      try {
        this.handler(JSON.parse(String(event.data)) as ServerSignalMessage);
      } catch {
        this.handler({ type: "error", message: "Received an invalid room message." });
      }
    });

    socket.addEventListener("close", () => {
      if (!this.closed) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 1200);
      }
    });

    socket.addEventListener("error", () => {
      this.handler({ type: "error", message: "Room signaling is unavailable. Start the Worker locally or deploy it." });
    });
  }

  sendSignal(to: string, signal: unknown): void {
    this.send({ type: "signal", to, signal });
  }

  sendChat(text: string): void {
    const trimmed = text.trim().slice(0, 280);
    if (trimmed) {
      this.send({ type: "chat", text: trimmed });
    }
  }

  sendGame(payload: RtcGameMessage): void {
    this.send({ type: "game", payload });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.socket = null;
  }

  private send(message: ClientSignalMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

export function formatChatTime(message: ChatMessage): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(message.at);
}
