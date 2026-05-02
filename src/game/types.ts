export type Direction = "up" | "down" | "left" | "right";

export type TileKind = "brick" | "steel";

export interface Arena {
  room: string;
  cols: number;
  rows: number;
  tileSize: number;
  tiles: Map<string, TileKind>;
  spawnPoints: Array<{ x: number; y: number }>;
}

export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  direction: Direction;
  color: string;
  score: number;
  alive: boolean;
  lastSeen: number;
}

export interface Bullet {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  direction: Direction;
  ttl: number;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
}

export interface SimulationStep {
  player: Player;
  bullets: Bullet[];
  brickHits: string[];
  steelHits: Array<{ x: number; y: number }>;
  hitPlayers: string[];
}

export interface RemotePlayerFrame {
  player: Player;
  bullets: Bullet[];
}

export type VisualEffect =
  | {
      type: "spark";
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      color: string;
      life: number;
      maxLife: number;
    }
  | {
      type: "flash";
      x: number;
      y: number;
      radius: number;
      color: string;
      life: number;
      maxLife: number;
    };
