import type { Arena, Bullet, Direction, InputState, Player, SimulationStep, TileKind } from "./types";

export const TANK_SIZE = 24;
export const BULLET_SIZE = 6;
export const PLAYER_SPEED = 138;
export const BULLET_SPEED = 312;
export const SHOT_COOLDOWN_MS = 420;

const COLORS = ["#f7c948", "#4fd1c5", "#f56565", "#90cdf4", "#b794f4", "#68d391", "#f6ad55", "#fc8181"];

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed: number): () => number {
  let value = seed === 0 ? 0x9e3779b9 : seed;
  return () => {
    value = Math.imul(1664525, value) + 1013904223;
    return (value >>> 0) / 4294967296;
  };
}

export function tileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function parseTileKey(key: string): { col: number; row: number } {
  const [col = "0", row = "0"] = key.split(":");
  return { col: Number(col), row: Number(row) };
}

export function createArena(room: string): Arena {
  const cols = 26;
  const rows = 18;
  const tileSize = 32;
  const tiles = new Map<string, TileKind>();
  const rng = makeRng(hashString(room.toLowerCase().trim() || "lobby"));
  const spawnPoints = [
    { x: 2.5 * tileSize, y: 2.5 * tileSize },
    { x: (cols - 2.5) * tileSize, y: (rows - 2.5) * tileSize },
    { x: 2.5 * tileSize, y: (rows - 2.5) * tileSize },
    { x: (cols - 2.5) * tileSize, y: 2.5 * tileSize },
    { x: (cols / 2) * tileSize, y: 2.5 * tileSize },
    { x: (cols / 2) * tileSize, y: (rows - 2.5) * tileSize },
  ];

  const inSpawnZone = (col: number, row: number) =>
    spawnPoints.some((spawn) => Math.abs(spawn.x / tileSize - col - 0.5) <= 2 && Math.abs(spawn.y / tileSize - row - 0.5) <= 2);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const border = col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
      const centerCol = Math.floor(cols / 2);
      const centerRow = Math.floor(rows / 2);
      const bunker =
        Math.abs(col - centerCol) <= 1 &&
        Math.abs(row - centerRow) <= 1 &&
        !(col === centerCol && row === centerRow - 1);
      if (border || (bunker && (col + row) % 2 === 0)) {
        tiles.set(tileKey(col, row), "steel");
        continue;
      }

      if (inSpawnZone(col, row)) {
        continue;
      }

      const verticalCluster = col % 4 === 1 && row > 1 && row < rows - 2 && row % 3 !== 0;
      const pairedCrate = col % 7 === 3 && row % 5 >= 2;
      const staggeredCrate = (col + row) % 9 === 0 && row > 2 && row < rows - 3;
      const bunkerCrate = Math.abs(col - centerCol) <= 1 && Math.abs(row - centerRow) <= 1;
      const randomBrick = rng() > 0.9 && row > 1 && row < rows - 2 && col > 1 && col < cols - 2;
      if (verticalCluster || pairedCrate || staggeredCrate || bunkerCrate || randomBrick) {
        tiles.set(tileKey(col, row), "brick");
      }
    }
  }

  return { room, cols, rows, tileSize, tiles, spawnPoints };
}

export function colorForId(id: string): string {
  return COLORS[hashString(id) % COLORS.length] ?? COLORS[0]!;
}

export function createPlayer(id: string, name: string, arena: Arena): Player {
  const spawn = arena.spawnPoints[hashString(id) % arena.spawnPoints.length] ?? arena.spawnPoints[0]!;
  return {
    id,
    name: name.trim().slice(0, 24) || "Player",
    x: spawn.x,
    y: spawn.y,
    direction: "up",
    color: colorForId(id),
    score: 0,
    alive: true,
    lastSeen: Date.now(),
  };
}

export function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function tankRect(player: Pick<Player, "x" | "y">) {
  return { x: player.x - TANK_SIZE / 2, y: player.y - TANK_SIZE / 2, w: TANK_SIZE, h: TANK_SIZE };
}

function tileRect(col: number, row: number, tileSize: number) {
  return { x: col * tileSize, y: row * tileSize, w: tileSize, h: tileSize };
}

export function isTankBlocked(arena: Arena, destroyedBricks: Set<string>, x: number, y: number, otherPlayers: Player[] = []): boolean {
  const rect = tankRect({ x, y });
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > arena.cols * arena.tileSize || rect.y + rect.h > arena.rows * arena.tileSize) {
    return true;
  }

  const minCol = Math.floor(rect.x / arena.tileSize);
  const maxCol = Math.floor((rect.x + rect.w) / arena.tileSize);
  const minRow = Math.floor(rect.y / arena.tileSize);
  const maxRow = Math.floor((rect.y + rect.h) / arena.tileSize);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const key = tileKey(col, row);
      const kind = arena.tiles.get(key);
      if (kind && !(kind === "brick" && destroyedBricks.has(key)) && rectsOverlap(rect, tileRect(col, row, arena.tileSize))) {
        return true;
      }
    }
  }

  return otherPlayers.some((other) => other.alive && rectsOverlap(rect, tankRect(other)));
}

function directionFromInput(input: InputState, fallback: Direction): Direction {
  if (input.up) return "up";
  if (input.down) return "down";
  if (input.left) return "left";
  if (input.right) return "right";
  return fallback;
}

function velocity(direction: Direction): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x: 0, y: -1 };
    case "down":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

export function tryMovePlayer(player: Player, input: InputState, dtSeconds: number, arena: Arena, destroyedBricks: Set<string>, otherPlayers: Player[] = []): Player {
  const direction = directionFromInput(input, player.direction);
  const moving = input.up || input.down || input.left || input.right;
  let next = { ...player, direction, lastSeen: Date.now() };
  if (!moving || !player.alive) {
    return next;
  }

  const axis = velocity(direction);
  const distance = PLAYER_SPEED * dtSeconds;
  const nextX = player.x + axis.x * distance;
  const nextY = player.y + axis.y * distance;

  if (!isTankBlocked(arena, destroyedBricks, nextX, player.y, otherPlayers)) {
    next = { ...next, x: nextX };
  }
  if (!isTankBlocked(arena, destroyedBricks, next.x, nextY, otherPlayers)) {
    next = { ...next, y: nextY };
  }
  return next;
}

export function createBullet(player: Player, now: number): Bullet {
  const axis = velocity(player.direction);
  return {
    id: `${player.id}:${now}`,
    ownerId: player.id,
    x: player.x + axis.x * (TANK_SIZE / 2 + BULLET_SIZE),
    y: player.y + axis.y * (TANK_SIZE / 2 + BULLET_SIZE),
    direction: player.direction,
    ttl: 1.8,
  };
}

export function updateBullets(
  bullets: Bullet[],
  dtSeconds: number,
  arena: Arena,
  destroyedBricks: Set<string>,
  players: Player[] = [],
): Pick<SimulationStep, "bullets" | "brickHits" | "steelHits" | "hitPlayers"> {
  const nextBullets: Bullet[] = [];
  const brickHits: string[] = [];
  const steelHits: Array<{ x: number; y: number }> = [];
  const hitPlayers: string[] = [];

  for (const bullet of bullets) {
    const axis = velocity(bullet.direction);
    const moved = {
      ...bullet,
      x: bullet.x + axis.x * BULLET_SPEED * dtSeconds,
      y: bullet.y + axis.y * BULLET_SPEED * dtSeconds,
      ttl: bullet.ttl - dtSeconds,
    };

    if (moved.ttl <= 0 || moved.x < 0 || moved.y < 0 || moved.x > arena.cols * arena.tileSize || moved.y > arena.rows * arena.tileSize) {
      continue;
    }

    const col = Math.floor(moved.x / arena.tileSize);
    const row = Math.floor(moved.y / arena.tileSize);
    const key = tileKey(col, row);
    const tile = arena.tiles.get(key);
    if (tile === "steel") {
      steelHits.push({ x: moved.x, y: moved.y });
      continue;
    }
    if (tile === "brick" && !destroyedBricks.has(key)) {
      brickHits.push(key);
      continue;
    }

    const bulletRect = { x: moved.x - BULLET_SIZE / 2, y: moved.y - BULLET_SIZE / 2, w: BULLET_SIZE, h: BULLET_SIZE };
    const hitPlayer = players.find((player) => player.id !== moved.ownerId && player.alive && rectsOverlap(bulletRect, tankRect(player)));
    if (hitPlayer) {
      hitPlayers.push(hitPlayer.id);
      continue;
    }

    nextBullets.push(moved);
  }

  return { bullets: nextBullets, brickHits, steelHits, hitPlayers };
}

export function applyBrickHits(destroyedBricks: Set<string>, brickHits: string[]): Set<string> {
  const next = new Set(destroyedBricks);
  for (const key of brickHits) {
    next.add(key);
  }
  return next;
}
