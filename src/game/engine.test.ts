import { expect, test } from "bun:test";
import { applyBrickHits, createArena, createPlayer, isTankBlocked, tileKey, updateBullets } from "./engine";
import type { Bullet } from "./types";

test("createArena is deterministic per room", () => {
  const a = createArena("alpha");
  const b = createArena("alpha");
  expect([...a.tiles.entries()]).toEqual([...b.tiles.entries()]);
});

test("brick collision blocks tanks until destroyed", () => {
  const arena = createArena("blocked");
  const brick = [...arena.tiles.entries()].find(([, kind]) => kind === "brick");
  expect(brick).toBeDefined();
  const [key] = brick!;
  const [col, row] = key.split(":").map(Number);
  const x = (col! + 0.5) * arena.tileSize;
  const y = (row! + 0.5) * arena.tileSize;

  expect(isTankBlocked(arena, new Set(), x, y)).toBe(true);
  expect(isTankBlocked(arena, new Set([key]), x, y)).toBe(false);
});

test("bullets destroy bricks and disappear", () => {
  const arena = createArena("brick-hit");
  const key = [...arena.tiles.entries()].find(([, kind]) => kind === "brick")?.[0] ?? tileKey(1, 1);
  const [col, row] = key.split(":").map(Number);
  const bullet: Bullet = {
    id: "b1",
    ownerId: "p1",
    x: (col! + 0.5) * arena.tileSize,
    y: (row! + 0.5) * arena.tileSize,
    direction: "up",
    ttl: 1,
  };

  const update = updateBullets([bullet], 0, arena, new Set());
  expect(update.bullets).toHaveLength(0);
  expect(update.brickHits).toEqual([key]);
  expect(applyBrickHits(new Set(), update.brickHits).has(key)).toBe(true);
});

test("bullets report steel impacts and disappear", () => {
  const arena = createArena("steel-hit");
  const key = [...arena.tiles.entries()].find(([, kind]) => kind === "steel")?.[0] ?? tileKey(0, 0);
  const [col, row] = key.split(":").map(Number);
  const bullet: Bullet = {
    id: "b2",
    ownerId: "p1",
    x: (col! + 0.5) * arena.tileSize,
    y: (row! + 0.5) * arena.tileSize,
    direction: "up",
    ttl: 1,
  };

  const update = updateBullets([bullet], 0, arena, new Set());
  expect(update.bullets).toHaveLength(0);
  expect(update.steelHits).toHaveLength(1);
});

test("players get stable room spawns and names are trimmed", () => {
  const arena = createArena("spawn");
  const player = createPlayer("player-1", "  Commander  ", arena);
  expect(player.name).toBe("Commander");
  expect(arena.spawnPoints.some((spawn) => spawn.x === player.x && spawn.y === player.y)).toBe(true);
});
