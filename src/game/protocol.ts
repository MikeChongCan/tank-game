import type { Bullet, Player } from "./types";

export interface PeerInfo {
  id: string;
  name: string;
}

export type ClientSignalMessage =
  | { type: "hello"; name: string }
  | { type: "signal"; to: string; signal: unknown }
  | { type: "chat"; text: string }
  | { type: "game"; payload: RtcGameMessage };

export type ServerSignalMessage =
  | { type: "welcome"; id: string; peers: PeerInfo[] }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; id: string }
  | { type: "signal"; from: string; signal: unknown }
  | { type: "room-game"; from: string; payload: RtcGameMessage }
  | { type: "room-chat"; id: string; name: string; text: string; at: number }
  | { type: "error"; message: string };

export type RtcGameMessage =
  | { type: "state"; player: Player; bullets: Bullet[] }
  | { type: "brick-hits"; hits: string[] }
  | { type: "player-hit"; targetId: string; byId: string }
  | { type: "sync"; player: Player; bullets: Bullet[]; destroyedBricks: string[] };

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
  at: number;
}

export function sanitizeRoom(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "lobby";
}

export function sanitizeName(input: string): string {
  return input
    .replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24) || "Player";
}
