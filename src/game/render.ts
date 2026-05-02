import { BULLET_SIZE, parseTileKey, TANK_SIZE } from "./engine";
import type { Arena, Bullet, Player, VisualEffect } from "./types";

interface RenderState {
  arena: Arena;
  localPlayer: Player | null;
  remotePlayers: Player[];
  localBullets: Bullet[];
  remoteBullets: Bullet[];
  destroyedBricks: Set<string>;
  effects: VisualEffect[];
  shake: number;
}

const PANEL_EDGE = "rgba(116, 235, 255, 0.62)";
const PANEL_PURPLE = "rgba(177, 105, 255, 0.5)";
const FLOOR_DOT = "rgba(54, 183, 255, 0.85)";

export function renderGame(canvas: HTMLCanvasElement, state: RenderState): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
  const targetHeight = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  drawLetterbox(context, rect.width, rect.height);

  const worldWidth = state.arena.cols * state.arena.tileSize;
  const worldHeight = state.arena.rows * state.arena.tileSize;
  const scale = Math.min(rect.width / worldWidth, rect.height / worldHeight);
  const offsetX = (rect.width - worldWidth * scale) / 2;
  const offsetY = (rect.height - worldHeight * scale) / 2;

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  if (state.shake > 0) {
    context.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
  }
  drawArena(context, state.arena, state.destroyedBricks);
  drawEffects(context, state.effects.filter((effect) => effect.type === "flash"));
  drawBullets(context, [...state.remoteBullets, ...state.localBullets]);
  for (const player of state.remotePlayers) {
    drawTank(context, player, false);
  }
  if (state.localPlayer) {
    drawTank(context, state.localPlayer, true);
  }
  drawEffects(context, state.effects.filter((effect) => effect.type === "spark"));
  context.restore();
}

function drawLetterbox(context: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#06080c");
  gradient.addColorStop(0.45, "#101820");
  gradient.addColorStop(1, "#031116");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawArena(context: CanvasRenderingContext2D, arena: Arena, destroyedBricks: Set<string>): void {
  const width = arena.cols * arena.tileSize;
  const height = arena.rows * arena.tileSize;

  const floor = context.createLinearGradient(0, 0, width, height);
  floor.addColorStop(0, "#1a1724");
  floor.addColorStop(0.48, "#18212a");
  floor.addColorStop(1, "#062229");
  context.fillStyle = floor;
  context.fillRect(0, 0, width, height);

  drawFloorGrid(context, arena);
  drawEdgeAtmosphere(context, width, height);

  for (const [key, kind] of arena.tiles.entries()) {
    if (kind === "brick" && destroyedBricks.has(key)) continue;
    const { col, row } = parseTileKey(key);
    const x = col * arena.tileSize;
    const y = row * arena.tileSize;
    drawTileShadow(context, x, y, arena.tileSize, kind === "steel" ? 0.36 : 0.45);
  }

  for (const [key, kind] of arena.tiles.entries()) {
    if (kind === "brick" && destroyedBricks.has(key)) continue;
    const { col, row } = parseTileKey(key);
    const x = col * arena.tileSize;
    const y = row * arena.tileSize;
    if (kind === "steel") {
      drawSteelPanel(context, x, y, arena.tileSize, col, row, arena);
    } else {
      drawCrate(context, x, y, arena.tileSize, col, row);
    }
  }
}

function drawFloorGrid(context: CanvasRenderingContext2D, arena: Arena): void {
  const width = arena.cols * arena.tileSize;
  const height = arena.rows * arena.tileSize;
  const inset = 1.5;

  context.save();
  for (let row = 0; row < arena.rows; row += 1) {
    for (let col = 0; col < arena.cols; col += 1) {
      const x = col * arena.tileSize;
      const y = row * arena.tileSize;
      const shade = (col + row) % 2 === 0 ? "rgba(255,255,255,0.018)" : "rgba(0,0,0,0.08)";
      context.fillStyle = shade;
      context.fillRect(x + inset, y + inset, arena.tileSize - inset * 2, arena.tileSize - inset * 2);
      context.strokeStyle = "rgba(135, 177, 205, 0.12)";
      context.lineWidth = 1;
      context.strokeRect(x + 0.5, y + 0.5, arena.tileSize - 1, arena.tileSize - 1);
    }
  }

  context.shadowBlur = 8;
  context.shadowColor = "rgba(39, 186, 255, 0.85)";
  for (let col = 1; col < arena.cols; col += 1) {
    for (let row = 1; row < arena.rows; row += 1) {
      const pulse = (col * 17 + row * 31) % 5 === 0 ? 1.55 : 1;
      context.fillStyle = FLOOR_DOT;
      context.beginPath();
      context.arc(col * arena.tileSize, row * arena.tileSize, 1.25 * pulse, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();

  const vignette = context.createRadialGradient(width * 0.52, height * 0.5, width * 0.25, width * 0.52, height * 0.5, width * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.44)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

function drawEdgeAtmosphere(context: CanvasRenderingContext2D, width: number, height: number): void {
  const left = context.createLinearGradient(0, 0, width * 0.22, 0);
  left.addColorStop(0, "rgba(135, 74, 255, 0.24)");
  left.addColorStop(1, "rgba(135, 74, 255, 0)");
  context.fillStyle = left;
  context.fillRect(0, 0, width * 0.25, height);

  const right = context.createLinearGradient(width, 0, width * 0.76, 0);
  right.addColorStop(0, "rgba(42, 236, 255, 0.22)");
  right.addColorStop(1, "rgba(42, 236, 255, 0)");
  context.fillStyle = right;
  context.fillRect(width * 0.75, 0, width * 0.25, height);
}

function drawTileShadow(context: CanvasRenderingContext2D, x: number, y: number, size: number, opacity: number): void {
  context.save();
  context.fillStyle = `rgba(0,0,0,${opacity})`;
  roundedRect(context, x + 5, y + 7, size - 3, size - 2, 4);
  context.fill();
  context.restore();
}

function drawSteelPanel(context: CanvasRenderingContext2D, x: number, y: number, size: number, col: number, row: number, arena: Arena): void {
  const leftEdge = col === 0;
  const rightEdge = col === arena.cols - 1;
  const edgeGlow = leftEdge ? PANEL_PURPLE : rightEdge ? PANEL_EDGE : "rgba(92, 224, 255, 0.35)";
  const pad = 2;

  context.save();
  context.shadowBlur = leftEdge || rightEdge ? 15 : 8;
  context.shadowColor = edgeGlow;
  const body = context.createLinearGradient(x, y, x + size, y + size);
  body.addColorStop(0, "#626d79");
  body.addColorStop(0.16, "#1e2630");
  body.addColorStop(0.55, "#303a45");
  body.addColorStop(1, "#0f151b");
  context.fillStyle = body;
  roundedRect(context, x + pad, y + pad, size - pad * 2, size - pad * 2, 4);
  context.fill();
  context.shadowBlur = 0;

  context.strokeStyle = "rgba(218, 232, 242, 0.35)";
  context.lineWidth = 1;
  roundedRect(context, x + 3.5, y + 3.5, size - 7, size - 7, 3);
  context.stroke();

  context.strokeStyle = "rgba(5, 9, 13, 0.74)";
  roundedRect(context, x + 7.5, y + 7.5, size - 15, size - 15, 3);
  context.stroke();

  context.fillStyle = edgeGlow;
  const glowW = Math.max(3, size * 0.13);
  context.fillRect(x + size * 0.36, y + size - 6, size * 0.28, glowW / 2);
  context.fillRect(x + size - 6, y + size * 0.36, glowW / 2, size * 0.28);
  context.restore();
}

function drawCrate(context: CanvasRenderingContext2D, x: number, y: number, size: number, col: number, row: number): void {
  const pad = 3;
  const hueShift = (col * 19 + row * 11) % 3;
  const bright = hueShift === 0 ? "#c98243" : hueShift === 1 ? "#b96b38" : "#d28b48";
  const dark = hueShift === 0 ? "#6c3323" : hueShift === 1 ? "#7b382d" : "#74451f";

  context.save();
  const body = context.createLinearGradient(x, y, x + size, y + size);
  body.addColorStop(0, bright);
  body.addColorStop(0.48, "#9d5431");
  body.addColorStop(1, dark);
  context.fillStyle = body;
  roundedRect(context, x + pad, y + pad, size - pad * 2, size - pad * 2, 3);
  context.fill();

  context.strokeStyle = "#301612";
  context.lineWidth = 2;
  roundedRect(context, x + pad + 0.5, y + pad + 0.5, size - pad * 2 - 1, size - pad * 2 - 1, 3);
  context.stroke();

  context.strokeStyle = "rgba(255, 211, 143, 0.42)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x + 8, y + 8);
  context.lineTo(x + size - 8, y + size - 8);
  context.moveTo(x + size - 8, y + 8);
  context.lineTo(x + 8, y + size - 8);
  context.stroke();

  context.fillStyle = "rgba(37, 16, 11, 0.48)";
  context.fillRect(x + 7, y + size * 0.45, size - 14, 3);
  context.fillRect(x + size * 0.45, y + 7, 3, size - 14);

  context.fillStyle = "#b9c0c9";
  const bolts: Array<[number, number]> = [
    [x + 6, y + 6],
    [x + size - 8, y + 6],
    [x + 6, y + size - 8],
    [x + size - 8, y + size - 8],
  ];
  for (const [boltX, boltY] of bolts) {
    context.fillRect(boltX, boltY, 3, 3);
    context.fillStyle = "#515963";
    context.fillRect(boltX + 1, boltY + 1, 2, 2);
    context.fillStyle = "#b9c0c9";
  }
  context.restore();
}

function drawTank(context: CanvasRenderingContext2D, player: Player, local: boolean): void {
  const alpha = player.alive ? 1 : 0.32;
  const rotation = player.direction === "up" ? 0 : player.direction === "right" ? Math.PI / 2 : player.direction === "down" ? Math.PI : -Math.PI / 2;

  context.save();
  context.globalAlpha = alpha;
  context.translate(player.x, player.y);

  context.save();
  context.globalAlpha *= player.alive ? 0.72 : 0.3;
  context.shadowBlur = local ? 30 : 20;
  context.shadowColor = hexToRgba(player.color, local ? 0.88 : 0.52);
  context.fillStyle = hexToRgba(player.color, local ? 0.26 : 0.18);
  context.beginPath();
  context.ellipse(0, 4, TANK_SIZE * 1.18, TANK_SIZE * 0.9, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.rotate(rotation);
  drawTankBody(context, player.color, local);
  context.restore();

  drawTankPips(context, player, local);
}

function drawTankBody(context: CanvasRenderingContext2D, color: string, local: boolean): void {
  const half = TANK_SIZE / 2;

  context.fillStyle = "rgba(0,0,0,0.42)";
  roundedRect(context, -half - 5, -half + 2, TANK_SIZE + 10, TANK_SIZE + 8, 6);
  context.fill();

  context.fillStyle = "#101720";
  roundedRect(context, -half - 6, -half + 1, 7, TANK_SIZE - 1, 3);
  context.fill();
  roundedRect(context, half - 1, -half + 1, 7, TANK_SIZE - 1, 3);
  context.fill();

  context.strokeStyle = "rgba(190, 206, 218, 0.28)";
  context.lineWidth = 1;
  for (let index = -8; index <= 8; index += 8) {
    context.beginPath();
    context.moveTo(-half - 5, index);
    context.lineTo(-half + 1, index + 3);
    context.moveTo(half + 5, index);
    context.lineTo(half - 1, index + 3);
    context.stroke();
  }

  const body = context.createLinearGradient(-half, -half, half, half);
  body.addColorStop(0, "#f0fbff");
  body.addColorStop(0.08, color);
  body.addColorStop(0.72, shadeHex(color, -42));
  body.addColorStop(1, "#071015");
  context.fillStyle = body;
  roundedRect(context, -half, -half, TANK_SIZE, TANK_SIZE, 5);
  context.fill();

  context.strokeStyle = local ? "rgba(255,255,255,0.96)" : "rgba(209, 232, 243, 0.58)";
  context.lineWidth = local ? 2.3 : 1.6;
  roundedRect(context, -half + 1, -half + 1, TANK_SIZE - 2, TANK_SIZE - 2, 4);
  context.stroke();

  context.fillStyle = "rgba(10, 18, 23, 0.56)";
  roundedRect(context, -6, -6, 12, 12, 3);
  context.fill();
  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.stroke();

  const barrel = context.createLinearGradient(-3, -half - 18, 3, -half - 18);
  barrel.addColorStop(0, "#ccd7df");
  barrel.addColorStop(0.5, "#f8fbff");
  barrel.addColorStop(1, "#6a7681");
  context.fillStyle = barrel;
  roundedRect(context, -3, -half - 19, 6, 20, 2);
  context.fill();
}

function drawTankPips(context: CanvasRenderingContext2D, player: Player, local: boolean): void {
  context.save();
  context.globalAlpha = player.alive ? 1 : 0.35;
  context.shadowBlur = local ? 10 : 6;
  context.shadowColor = player.color;
  context.fillStyle = local ? "#f4e4ff" : hexToRgba(player.color, 0.92);
  for (let index = 0; index < 3; index += 1) {
    context.fillRect(player.x - 11 + index * 8, player.y - TANK_SIZE - 9, 5, 5);
  }
  context.restore();
}

function drawBullets(context: CanvasRenderingContext2D, bullets: Bullet[]): void {
  for (const bullet of bullets) {
    const trail = bulletTrail(bullet);
    context.save();
    context.strokeStyle = "rgba(255, 221, 128, 0.55)";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.shadowBlur = 12;
    context.shadowColor = "rgba(255, 232, 155, 0.95)";
    context.beginPath();
    context.moveTo(bullet.x - trail.x, bullet.y - trail.y);
    context.lineTo(bullet.x, bullet.y);
    context.stroke();

    context.fillStyle = "#fff7cf";
    context.beginPath();
    context.arc(bullet.x, bullet.y, BULLET_SIZE / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function bulletTrail(bullet: Bullet): { x: number; y: number } {
  const length = 15;
  switch (bullet.direction) {
    case "up":
      return { x: 0, y: -length };
    case "down":
      return { x: 0, y: length };
    case "left":
      return { x: -length, y: 0 };
    case "right":
      return { x: length, y: 0 };
  }
}

function drawEffects(context: CanvasRenderingContext2D, effects: VisualEffect[]): void {
  for (const effect of effects) {
    const progress = Math.max(0, Math.min(1, effect.life / effect.maxLife));
    context.save();
    context.globalAlpha = progress;
    if (effect.type === "flash") {
      const radius = effect.radius * (1.65 - progress * 0.5);
      const gradient = context.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, radius);
      gradient.addColorStop(0, effect.color);
      gradient.addColorStop(0.32, "rgba(255, 235, 166, 0.72)");
      gradient.addColorStop(0.68, "rgba(255, 134, 62, 0.2)");
      gradient.addColorStop(1, "rgba(255, 134, 62, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.28)";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(effect.x, effect.y, effect.radius * (1.05 - progress * 0.28), 0, Math.PI * 2);
      context.stroke();
    } else {
      context.shadowBlur = 8;
      context.shadowColor = effect.color;
      context.fillStyle = effect.color;
      context.beginPath();
      context.arc(effect.x, effect.y, Math.max(0.6, effect.radius * progress), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const parsed = Number.parseInt(value.length === 3 ? value.split("").map((part) => `${part}${part}`).join("") : value, 16);
  const r = (parsed >> 16) & 255;
  const g = (parsed >> 8) & 255;
  const b = parsed & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shadeHex(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const parsed = Number.parseInt(value, 16);
  const r = Math.max(0, Math.min(255, ((parsed >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((parsed >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (parsed & 255) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}
