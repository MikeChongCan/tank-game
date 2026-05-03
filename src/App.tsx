import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SHOT_COOLDOWN_MS,
  applyBrickHits,
  applyBrickRespawns,
  createArena,
  createBullet,
  createPlayer,
  hashString,
  parseTileKey,
  TANK_SIZE,
  tryMovePlayer,
  updateBullets,
} from "./game/engine";
import { GameAudio } from "./game/audio";
import type { ChatMessage, PeerInfo, RtcGameMessage, ServerSignalMessage } from "./game/protocol";
import { sanitizeName, sanitizeRoom } from "./game/protocol";
import { renderGame } from "./game/render";
import type { Arena, Bullet, Direction, InputState, Player, VisualEffect } from "./game/types";
import { createI18n, type Locale, type Translate } from "./i18n";
import { formatChatTime, SignalingRoom } from "./net/signaling";
import { RtcMesh } from "./net/webrtc";

const EMPTY_INPUT: InputState = { up: false, down: false, left: false, right: false, shoot: false };
const TOUCH_POSITION_STORAGE_KEY = "tank-touch-control-positions";
const BRICK_RESPAWN_MS = 12000;

type TouchControlId = "move" | "fire";

interface TouchControlPosition {
  x: number;
  y: number;
}

type TouchControlPositions = Record<TouchControlId, TouchControlPosition>;

const DEFAULT_TOUCH_POSITIONS: TouchControlPositions = {
  move: { x: 34, y: 72 },
  fire: { x: 78, y: 74 },
};

const TOUCH_BOUNDS: Record<TouchControlId, { minX: number; maxX: number; minY: number; maxY: number }> = {
  move: { minX: 32, maxX: 68, minY: 30, maxY: 86 },
  fire: { minX: 16, maxX: 84, minY: 16, maxY: 88 },
};
const MOVE_KEYS = ["up", "down", "left", "right"] as const;
const JOYSTICK_DEAD_ZONE = 14;
const JOYSTICK_MAX_OFFSET = 46;

function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function loadTouchControlPositions(): TouchControlPositions {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOUCH_POSITION_STORAGE_KEY) || "null") as Partial<TouchControlPositions> | null;
    return {
      move: clampTouchPosition("move", parsed?.move ?? DEFAULT_TOUCH_POSITIONS.move),
      fire: clampTouchPosition("fire", parsed?.fire ?? DEFAULT_TOUCH_POSITIONS.fire),
    };
  } catch {
    return DEFAULT_TOUCH_POSITIONS;
  }
}

function saveTouchControlPositions(positions: TouchControlPositions): void {
  localStorage.setItem(TOUCH_POSITION_STORAGE_KEY, JSON.stringify(positions));
}

function clampTouchPosition(id: TouchControlId, position: TouchControlPosition): TouchControlPosition {
  const bounds = TOUCH_BOUNDS[id];
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, position.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, position.y)),
  };
}

function joystickDirection(dx: number, dy: number): Direction | null {
  if (Math.hypot(dx, dy) < JOYSTICK_DEAD_ZONE) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

function clampJoystickOffset(dx: number, dy: number): TouchControlPosition {
  const distance = Math.hypot(dx, dy);
  if (distance <= JOYSTICK_MAX_OFFSET) return { x: dx, y: dy };
  const scale = JOYSTICK_MAX_OFFSET / distance;
  return { x: dx * scale, y: dy * scale };
}

function localizedMessage(t: Translate, message: string): string {
  return message.includes(".") ? t(message) : message;
}

function localizedPeerName(t: Translate, name: string): string {
  const suffix = " (connecting)";
  return name.endsWith(suffix) ? t("players.connecting", { name: name.slice(0, -suffix.length) }) : name;
}

function initialRoom(): string {
  const room = new URLSearchParams(window.location.search).get("room") || localStorage.getItem("tank-room") || "lobby";
  return sanitizeRoom(room);
}

function initialName(): string {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("name") || params.get("player") || localStorage.getItem("tank-name") || "";
  return raw.trim() ? sanitizeName(raw) : "";
}

function respawn(player: Player, arena: Arena): Player {
  const spawn = arena.spawnPoints[(hashString(`${player.id}:${Date.now()}`) % arena.spawnPoints.length) || 0] ?? arena.spawnPoints[0]!;
  return { ...player, x: spawn.x, y: spawn.y, alive: true, direction: "up", lastSeen: Date.now() };
}

export default function App() {
  const i18n = useMemo(() => createI18n(), []);
  const [name, setName] = useState(initialName);
  const [room, setRoom] = useState(initialRoom);
  const [joined, setJoined] = useState(Boolean(initialName()));

  useEffect(() => {
    document.documentElement.lang = i18n.locale;
    document.title = i18n.t("app.title");
  }, [i18n]);

  function joinGame() {
    const safeName = sanitizeName(name);
    const safeRoom = sanitizeRoom(room);
    localStorage.setItem("tank-name", safeName);
    localStorage.setItem("tank-room", safeRoom);
    setName(safeName);
    setRoom(safeRoom);
    setJoined(true);
  }

  if (!joined) {
    return <JoinScreen t={i18n.t} name={name} room={room} onName={setName} onRoom={setRoom} onJoin={joinGame} />;
  }

  return <TankRoomView t={i18n.t} locale={i18n.locale} name={name} room={room} onLeave={() => setJoined(false)} />;
}

function JoinScreen({
  t,
  name,
  room,
  onName,
  onRoom,
  onJoin,
}: {
  t: Translate;
  name: string;
  room: string;
  onName: (value: string) => void;
  onRoom: (value: string) => void;
  onJoin: () => void;
}) {
  return (
    <main className="join-shell">
      <section className="join-panel" aria-label={t("join.aria")}>
        <div className="brand-lockup">
          <img src="/assets/tank-app-icon.png" alt="" aria-hidden="true" />
          <div>
            <p className="eyebrow">{t("brand.eyebrow")}</p>
            <h1>{t("app.title")}</h1>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onJoin();
          }}
        >
          <label>
            {t("join.nameLabel")}
            <input autoFocus value={name} maxLength={24} onChange={(event) => onName(event.target.value)} placeholder={t("join.namePlaceholder")} />
          </label>
          <label>
            {t("join.roomLabel")}
            <input value={room} maxLength={32} onChange={(event) => onRoom(event.target.value)} placeholder={t("join.roomPlaceholder")} />
          </label>
          <button type="submit">{t("join.submit")}</button>
        </form>
      </section>
      <div className="join-preview" aria-hidden="true">
        <div className="preview-tank" />
        <div className="preview-wall wall-a" />
        <div className="preview-wall wall-b" />
        <div className="preview-wall wall-c" />
      </div>
    </main>
  );
}

function TankRoomView({ t, locale, room, name, onLeave }: { t: Translate; locale: Locale; room: string; name: string; onLeave: () => void }) {
  const arena = useMemo(() => createArena(room), [room]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<InputState>({ ...EMPTY_INPUT });
  const localPlayerRef = useRef<Player | null>(null);
  const localBulletsRef = useRef<Bullet[]>([]);
  const remotePlayersRef = useRef(new Map<string, Player>());
  const remoteBulletsRef = useRef(new Map<string, Bullet[]>());
  const destroyedBricksRef = useRef(new Set<string>());
  const brickRespawnsRef = useRef(new Map<string, number>());
  const brickRespawnTimersRef = useRef(new Map<string, number>());
  const effectsRef = useRef<VisualEffect[]>([]);
  const shakeRef = useRef(0);
  const audioRef = useRef(new GameAudio());
  const meshRef = useRef<RtcMesh | null>(null);
  const lastShotRef = useRef(0);
  const respawnTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [selfId, setSelfId] = useState("");
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [status, setStatus] = useState("status.connecting");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [, setUiVersion] = useState(0);
  const signalingRef = useRef<SignalingRoom | null>(null);

  const refreshUi = useCallback(() => {
    setUiVersion((version) => (version + 1) % 100000);
  }, []);

  const addFlash = useCallback((x: number, y: number, radius = 34, color = "rgba(255, 219, 132, 0.95)") => {
    effectsRef.current = [...effectsRef.current, { type: "flash", x, y, radius, color, life: 0.16, maxLife: 0.16 }];
  }, []);

  const addBurst = useCallback((x: number, y: number, color = "#f59e0b", count = 18) => {
    const next: VisualEffect[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 170;
      next.push({
        type: "spark",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3.5,
        color: index % 3 === 0 ? "#fef3c7" : color,
        life: 0.28 + Math.random() * 0.32,
        maxLife: 0.6,
      });
    }
    effectsRef.current = [...effectsRef.current, ...next].slice(-220);
  }, []);

  const addMuzzleFlash = useCallback(
    (player: Player) => {
      const offsets: Record<Direction, { x: number; y: number }> = {
        up: { x: 0, y: -(TANK_SIZE / 2 + 18) },
        down: { x: 0, y: TANK_SIZE / 2 + 18 },
        left: { x: -(TANK_SIZE / 2 + 18), y: 0 },
        right: { x: TANK_SIZE / 2 + 18, y: 0 },
      };
      const offset = offsets[player.direction];
      addFlash(player.x + offset.x, player.y + offset.y, 22, "rgba(255, 245, 180, 0.9)");
    },
    [addFlash],
  );

  const publishGameMessage = useCallback((message: RtcGameMessage) => {
    const sentToAllPeers = meshRef.current?.broadcast(message) ?? true;
    if (!sentToAllPeers) {
      signalingRef.current?.sendGame(message);
    }
  }, []);

  const broadcastSync = useCallback((peerId?: string) => {
    const player = localPlayerRef.current;
    if (!player) return;
    const message: RtcGameMessage = {
      type: "sync",
      player,
      bullets: localBulletsRef.current,
      destroyedBricks: [...destroyedBricksRef.current],
      brickRespawns: [...brickRespawnsRef.current].map(([key, respawnAt]) => [key, Math.max(0, respawnAt - Date.now())]),
    };
    if (peerId) {
      const sent = meshRef.current?.sendTo(peerId, message) ?? false;
      if (!sent) signalingRef.current?.sendGame(message);
      return;
    }
    publishGameMessage(message);
  }, [publishGameMessage]);

  const clearBrickRespawnTimers = useCallback(() => {
    for (const timer of brickRespawnTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    brickRespawnTimersRef.current.clear();
    brickRespawnsRef.current.clear();
  }, []);

  const scheduleBrickRespawn = useCallback(
    (key: string, respawnAt: number, publish: boolean) => {
      const existing = brickRespawnTimersRef.current.get(key);
      if (existing) window.clearTimeout(existing);

      brickRespawnsRef.current.set(key, respawnAt);
      const delay = Math.max(0, respawnAt - Date.now());
      const timer = window.setTimeout(() => {
        brickRespawnTimersRef.current.delete(key);
        brickRespawnsRef.current.delete(key);
        if (!destroyedBricksRef.current.has(key)) return;

        destroyedBricksRef.current = applyBrickRespawns(destroyedBricksRef.current, [key]);
        const { col, row } = parseTileKey(key);
        const x = (col + 0.5) * arena.tileSize;
        const y = (row + 0.5) * arena.tileSize;
        addFlash(x, y, 20, "rgba(112, 231, 255, 0.72)");
        addBurst(x, y, "#67e8f9", 8);
        if (publish) {
          publishGameMessage({ type: "brick-respawns", keys: [key] });
        }
        refreshUi();
      }, delay);
      brickRespawnTimersRef.current.set(key, timer);
    },
    [addBurst, addFlash, arena.tileSize, publishGameMessage, refreshUi],
  );

  const applyDestroyedBricks = useCallback(
    (keys: string[], respawnInMs: number, publishRespawn: boolean): string[] => {
      const newHits = keys.filter((key) => !destroyedBricksRef.current.has(key));
      if (!newHits.length) return [];

      const respawnAt = Date.now() + respawnInMs;
      destroyedBricksRef.current = applyBrickHits(destroyedBricksRef.current, newHits);
      for (const key of newHits) {
        const { col, row } = parseTileKey(key);
        addBurst((col + 0.5) * arena.tileSize, (row + 0.5) * arena.tileSize, "#fb923c", 16);
        scheduleBrickRespawn(key, respawnAt, publishRespawn);
      }
      return newHits;
    },
    [addBurst, arena.tileSize, scheduleBrickRespawn],
  );

  const applyRespawnedBricks = useCallback(
    (keys: string[]) => {
      const restored = keys.filter((key) => destroyedBricksRef.current.has(key));
      if (!restored.length) return;

      destroyedBricksRef.current = applyBrickRespawns(destroyedBricksRef.current, restored);
      for (const key of restored) {
        const timer = brickRespawnTimersRef.current.get(key);
        if (timer) window.clearTimeout(timer);
        brickRespawnTimersRef.current.delete(key);
        brickRespawnsRef.current.delete(key);
        const { col, row } = parseTileKey(key);
        const x = (col + 0.5) * arena.tileSize;
        const y = (row + 0.5) * arena.tileSize;
        addFlash(x, y, 20, "rgba(112, 231, 255, 0.72)");
        addBurst(x, y, "#67e8f9", 8);
      }
      refreshUi();
    },
    [addBurst, addFlash, arena.tileSize, refreshUi],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleRtcMessage = useCallback(
    (from: string, message: RtcGameMessage) => {
      if ((message.type === "state" || message.type === "sync") && message.player.id !== from) {
        return;
      }
      if (message.type === "player-hit" && message.byId !== from) {
        return;
      }

      if (message.type === "state") {
        remotePlayersRef.current.set(message.player.id, { ...message.player, lastSeen: Date.now() });
        remoteBulletsRef.current.set(message.player.id, message.bullets);
        refreshUi();
        return;
      }

      if (message.type === "brick-hits") {
        const newHits = applyDestroyedBricks(message.hits, message.respawnInMs, false);
        if (newHits.length > 0) {
          audioRef.current.brick();
          vibrate([14, 22, 18]);
          refreshUi();
        }
        return;
      }

      if (message.type === "brick-respawns") {
        applyRespawnedBricks(message.keys);
        return;
      }

      if (message.type === "sync") {
        remotePlayersRef.current.set(message.player.id, { ...message.player, lastSeen: Date.now() });
        remoteBulletsRef.current.set(message.player.id, message.bullets);
        destroyedBricksRef.current = applyBrickHits(destroyedBricksRef.current, message.destroyedBricks);
        for (const [key, respawnInMs] of message.brickRespawns) {
          if (destroyedBricksRef.current.has(key) && !brickRespawnsRef.current.has(key)) {
            scheduleBrickRespawn(key, Date.now() + respawnInMs, false);
          }
        }
        refreshUi();
        return;
      }

      if (message.type === "player-hit") {
        if (message.targetId === localPlayerRef.current?.id && localPlayerRef.current.alive) {
          localPlayerRef.current = { ...localPlayerRef.current, alive: false };
          addBurst(localPlayerRef.current.x, localPlayerRef.current.y, "#f97316", 28);
          shakeRef.current = Math.max(shakeRef.current, 8);
          audioRef.current.hit();
          vibrate([24, 30, 42]);
          if (respawnTimerRef.current) window.clearTimeout(respawnTimerRef.current);
          respawnTimerRef.current = window.setTimeout(() => {
            const player = localPlayerRef.current;
            if (mountedRef.current && player) {
              localPlayerRef.current = respawn(player, arena);
              audioRef.current.respawn();
              vibrate(18);
              refreshUi();
            }
          }, 1100);
          refreshUi();
        } else {
          const remote = remotePlayersRef.current.get(message.targetId);
          if (remote?.alive) {
            remotePlayersRef.current.set(message.targetId, { ...remote, alive: false });
            addBurst(remote.x, remote.y, "#f97316", 28);
            shakeRef.current = Math.max(shakeRef.current, 6);
            vibrate(22);
            refreshUi();
          }
        }
      }
    },
    [addBurst, applyDestroyedBricks, applyRespawnedBricks, arena, refreshUi, scheduleBrickRespawn],
  );

  useEffect(() => {
    const signaling = new SignalingRoom(room, name, (message: ServerSignalMessage) => {
      if (message.type === "welcome") {
        setError("");
        setSelfId(message.id);
        localPlayerRef.current = createPlayer(message.id, name, arena);
        meshRef.current?.close();
        const mesh = new RtcMesh(
          (to, signal) => signaling.sendSignal(to, signal),
          handleRtcMessage,
          setPeers,
          (peerId) => broadcastSync(peerId),
        );
        meshRef.current = mesh;
        mesh.connectToExisting(message.peers);
        setStatus("status.inRoom");
        return;
      }

      if (message.type === "peer-joined") {
        meshRef.current?.addWaitingPeer(message.peer);
        setPeers((current) => (current.some((peer) => peer.id === message.peer.id) ? current : [...current, message.peer]));
        return;
      }

      if (message.type === "peer-left") {
        meshRef.current?.removePeer(message.id);
        remotePlayersRef.current.delete(message.id);
        remoteBulletsRef.current.delete(message.id);
        refreshUi();
        return;
      }

      if (message.type === "signal") {
        void meshRef.current?.receiveSignal(message.from, message.signal).catch(() => setError("status.peerFailed"));
        return;
      }

      if (message.type === "room-game") {
        handleRtcMessage(message.from, message.payload);
        return;
      }

      if (message.type === "room-chat") {
        setMessages((current) => [...current.slice(-80), { id: message.id, name: message.name, text: message.text, at: message.at }]);
        return;
      }

      if (message.type === "error") {
        setError(message.message);
      }
    });

    signalingRef.current = signaling;
      signaling.connect();
      return () => {
        signaling.close();
        meshRef.current?.close();
        audioRef.current.dispose();
        if (respawnTimerRef.current) window.clearTimeout(respawnTimerRef.current);
        clearBrickRespawnTimers();
      };
  }, [arena, broadcastSync, clearBrickRespawnTimers, handleRtcMessage, name, room]);

  useEffect(() => {
    const keyMap: Record<string, keyof InputState> = {
      ArrowUp: "up",
      KeyW: "up",
      ArrowDown: "down",
      KeyS: "down",
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
      Space: "shoot",
    };

    const update = (event: KeyboardEvent, active: boolean) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      const mapped = keyMap[event.code];
      if (mapped) {
        event.preventDefault();
        audioRef.current.unlock();
        inputRef.current = { ...inputRef.current, [mapped]: active };
      }
    };

    const down = (event: KeyboardEvent) => update(event, true);
    const up = (event: KeyboardEvent) => update(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastBroadcast = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const player = localPlayerRef.current;
      if (player) {
        const remotePlayers = [...remotePlayersRef.current.values()];
        const moving = inputRef.current.up || inputRef.current.down || inputRef.current.left || inputRef.current.right;
        if (moving && player.alive) audioRef.current.move(now);
        let nextPlayer = tryMovePlayer(player, inputRef.current, dt, arena, destroyedBricksRef.current, remotePlayers);

        if (inputRef.current.shoot && nextPlayer.alive && now - lastShotRef.current > SHOT_COOLDOWN_MS) {
          localBulletsRef.current = [...localBulletsRef.current, createBullet(nextPlayer, Math.floor(now))];
          addMuzzleFlash(nextPlayer);
          audioRef.current.shoot();
          vibrate(14);
          lastShotRef.current = now;
        }

        const bulletUpdate = updateBullets(localBulletsRef.current, dt, arena, destroyedBricksRef.current, remotePlayers);
        localBulletsRef.current = bulletUpdate.bullets;
        if (bulletUpdate.brickHits.length) {
          const newHits = applyDestroyedBricks(bulletUpdate.brickHits, BRICK_RESPAWN_MS, true);
          if (newHits.length) {
            shakeRef.current = Math.max(shakeRef.current, 4);
            audioRef.current.brick();
            vibrate([12, 18, 12]);
            const message: RtcGameMessage = { type: "brick-hits", hits: newHits, respawnInMs: BRICK_RESPAWN_MS };
            publishGameMessage(message);
          }
        }
        if (bulletUpdate.steelHits.length) {
          for (const hit of bulletUpdate.steelHits) {
            addFlash(hit.x, hit.y, 18, "rgba(160, 244, 255, 0.82)");
            addBurst(hit.x, hit.y, "#67e8f9", 8);
          }
          shakeRef.current = Math.max(shakeRef.current, 2.5);
          audioRef.current.steel();
          vibrate(8);
        }
        if (bulletUpdate.hitPlayers.length) {
          nextPlayer = { ...nextPlayer, score: nextPlayer.score + bulletUpdate.hitPlayers.length };
          for (const targetId of bulletUpdate.hitPlayers) {
            const message: RtcGameMessage = { type: "player-hit", targetId, byId: nextPlayer.id };
            publishGameMessage(message);
            const remote = remotePlayersRef.current.get(targetId);
            if (remote) {
              remotePlayersRef.current.set(targetId, { ...remote, alive: false });
              addBurst(remote.x, remote.y, "#f97316", 28);
            }
          }
          shakeRef.current = Math.max(shakeRef.current, 7);
          audioRef.current.hit();
          vibrate([22, 28, 38]);
          refreshUi();
        }

        localPlayerRef.current = nextPlayer;
        if (now - lastBroadcast > 70) {
          const message: RtcGameMessage = { type: "state", player: nextPlayer, bullets: localBulletsRef.current };
          publishGameMessage(message);
          lastBroadcast = now;
        }
      }

      effectsRef.current = effectsRef.current
        .map((effect) =>
          effect.type === "spark"
            ? { ...effect, x: effect.x + effect.vx * dt, y: effect.y + effect.vy * dt, vy: effect.vy + 210 * dt, life: effect.life - dt }
            : { ...effect, life: effect.life - dt },
        )
        .filter((effect) => effect.life > 0);
      shakeRef.current = Math.max(0, shakeRef.current - 22 * dt);

      for (const [id, bullets] of remoteBulletsRef.current) {
        const players = [localPlayerRef.current, ...remotePlayersRef.current.values()].filter(Boolean) as Player[];
        const remoteUpdate = updateBullets(bullets, dt, arena, destroyedBricksRef.current, players);
        remoteBulletsRef.current.set(id, remoteUpdate.bullets);
        for (const hit of remoteUpdate.steelHits) {
          addFlash(hit.x, hit.y, 14, "rgba(160, 244, 255, 0.74)");
          addBurst(hit.x, hit.y, "#67e8f9", 5);
        }
        if (remoteUpdate.steelHits.length > 0) {
          audioRef.current.steel();
        }
      }

      const cutoff = Date.now() - 5000;
      let removedStalePlayer = false;
      for (const [id, remote] of remotePlayersRef.current) {
        if (remote.lastSeen < cutoff) {
          remotePlayersRef.current.delete(id);
          remoteBulletsRef.current.delete(id);
          removedStalePlayer = true;
        }
      }
      if (removedStalePlayer) refreshUi();

      const canvas = canvasRef.current;
      if (canvas) {
        renderGame(canvas, {
          arena,
          localPlayer: localPlayerRef.current,
          remotePlayers: [...remotePlayersRef.current.values()],
          localBullets: localBulletsRef.current,
          remoteBullets: [...remoteBulletsRef.current.values()].flat(),
          destroyedBricks: destroyedBricksRef.current,
          effects: effectsRef.current,
          shake: shakeRef.current,
        });
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [addBurst, addFlash, addMuzzleFlash, applyDestroyedBricks, arena, publishGameMessage]);

  const setControl = (key: keyof InputState, active: boolean) => {
    if (active) audioRef.current.unlock();
    if (active) {
      audioRef.current.ui();
      vibrate(key === "shoot" ? 12 : 6);
    }
    inputRef.current = { ...inputRef.current, [key]: active };
  };

  const setMovement = (direction: Direction | null) => {
    const previousDirection = MOVE_KEYS.find((key) => inputRef.current[key]) ?? null;
    if (direction) {
      audioRef.current.unlock();
      if (direction !== previousDirection) {
        audioRef.current.ui();
        vibrate(5);
      }
    }
    inputRef.current = {
      ...inputRef.current,
      up: direction === "up",
      down: direction === "down",
      left: direction === "left",
      right: direction === "right",
    };
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    signalingRef.current?.sendChat(chatText);
    setChatText("");
  };

  const playerRows = [localPlayerRef.current, ...[...remotePlayersRef.current.values()]].filter(Boolean) as Player[];
  const roomStatus = error ? localizedMessage(t, error) : localizedMessage(t, status);

  return (
    <main className="game-shell">
      <header className="topbar">
        <div>
          <h1>{t("app.title")}</h1>
          <span>{room}</span>
        </div>
        <div className="top-actions">
          <span className="status-pill">{roomStatus}</span>
          <button
            className="icon-button"
            type="button"
            aria-label={muted ? t("audio.unmute") : t("audio.mute")}
            title={muted ? t("audio.unmute") : t("audio.mute")}
            onClick={() => {
              const nextMuted = !muted;
              setMuted(nextMuted);
              audioRef.current.setMuted(nextMuted);
              if (!nextMuted) {
                audioRef.current.unlock();
                audioRef.current.ui();
              }
            }}
          >
            {muted ? t("audio.on") : t("audio.muted")}
          </button>
          <button
            onClick={() => {
              audioRef.current.ui();
              onLeave();
            }}
          >
            {t("nav.leave")}
          </button>
        </div>
      </header>
      <section className="play-area">
        <div className="stage">
          <canvas ref={canvasRef} aria-label={t("canvas.aria")} />
          {!selfId && <div className="connection-overlay">{t("status.connectingRoom")}</div>}
          <TouchControls t={t} setControl={setControl} setMovement={setMovement} />
        </div>
        <aside className="sidebar">
          <section className="panel">
            <h2>{t("players.title")}</h2>
            <ul className="players">
              {playerRows.map((player) => (
                <li key={player.id}>
                  <span className="swatch" style={{ background: player.color }} />
                  <span>{player.id === selfId ? t("players.you", { name: player.name }) : player.name}</span>
                  <strong>{player.score}</strong>
                </li>
              ))}
              {peers.map((peer) =>
                remotePlayersRef.current.has(peer.id) ? null : (
                  <li key={peer.id}>
                    <span className="swatch pending" />
                    <span>{localizedPeerName(t, peer.name)}</span>
                    <strong>...</strong>
                  </li>
                ),
              )}
            </ul>
          </section>
          <section className="panel chat-panel">
            <h2>{t("chat.title")}</h2>
            <div className="messages">
              {messages.map((message, index) => (
                <p key={`${message.at}:${index}`}>
                  <time>{formatChatTime(message, locale)}</time>
                  <b>{message.name}</b>
                  <span>{message.text}</span>
                </p>
              ))}
            </div>
            <form onSubmit={sendChat}>
              <input value={chatText} maxLength={280} onChange={(event) => setChatText(event.target.value)} placeholder={t("chat.placeholder")} />
              <button type="submit">{t("chat.send")}</button>
            </form>
          </section>
        </aside>
      </section>
    </main>
  );
}

function TouchControls({
  t,
  setControl,
  setMovement,
}: {
  t: Translate;
  setControl: (key: keyof InputState, active: boolean) => void;
  setMovement: (direction: Direction | null) => void;
}) {
  const [positions, setPositions] = useState<TouchControlPositions>(loadTouchControlPositions);
  const [joystick, setJoystick] = useState({ x: 0, y: 0, active: false });
  const [fireDragging, setFireDragging] = useState(false);
  const joystickPointerRef = useRef<number | null>(null);
  const fireDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    saveTouchControlPositions(positions);
  }, [positions]);

  const stagePoint = (event: React.PointerEvent<HTMLElement>): TouchControlPosition | null => {
    const stage = event.currentTarget.closest(".stage");
    const rect = stage?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  };

  const updateJoystick = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const offset = clampJoystickOffset(dx, dy);
    setJoystick({ ...offset, active: true });
    setMovement(joystickDirection(dx, dy));
  };

  const stopJoystick = (event: React.PointerEvent<HTMLElement>) => {
    if (joystickPointerRef.current !== event.pointerId) return;
    joystickPointerRef.current = null;
    setJoystick({ x: 0, y: 0, active: false });
    setMovement(null);
  };

  const joystickHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      joystickPointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      updateJoystick(event);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (joystickPointerRef.current !== event.pointerId) return;
      updateJoystick(event);
    },
    onPointerUp: stopJoystick,
    onPointerCancel: stopJoystick,
    onLostPointerCapture: stopJoystick,
  };

  const updateFirePosition = (event: React.PointerEvent<HTMLElement>) => {
    const drag = fireDragRef.current;
    const point = stagePoint(event);
    if (!drag || !point) return;
    const next = clampTouchPosition("fire", {
      x: point.x + drag.offsetX,
      y: point.y + drag.offsetY,
    });
    setPositions((current) => ({ ...current, fire: next }));
  };

  const fireHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const point = stagePoint(event);
      if (point) {
        fireDragRef.current = {
          pointerId: event.pointerId,
          offsetX: positions.fire.x - point.x,
          offsetY: positions.fire.y - point.y,
        };
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      setFireDragging(true);
      setControl("shoot", true);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (fireDragRef.current?.pointerId !== event.pointerId) return;
      updateFirePosition(event);
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (fireDragRef.current?.pointerId === event.pointerId) fireDragRef.current = null;
      setFireDragging(false);
      setControl("shoot", false);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (fireDragRef.current?.pointerId === event.pointerId) fireDragRef.current = null;
      setFireDragging(false);
      setControl("shoot", false);
    },
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (fireDragRef.current?.pointerId === event.pointerId) fireDragRef.current = null;
      setFireDragging(false);
      setControl("shoot", false);
    },
  };

  return (
    <div className="touch-controls" aria-label={t("controls.group")}>
      <div className="floating-control move-control" style={{ left: `${positions.move.x}%`, top: `${positions.move.y}%` }}>
        <div className={`joystick${joystick.active ? " is-active" : ""}`} {...joystickHandlers} aria-label={t("controls.joystick")} role="button" tabIndex={0}>
          <div className="joystick-ring" aria-hidden="true" />
          <div
            className="joystick-thumb"
            style={{ transform: `translate(calc(-50% + ${joystick.x}px), calc(-50% + ${joystick.y}px))` }}
            aria-hidden="true"
          />
        </div>
      </div>
      <div className="floating-control fire-control" style={{ left: `${positions.fire.x}%`, top: `${positions.fire.y}%` }}>
        <button className={`fire${fireDragging ? " is-dragging" : ""}`} {...fireHandlers} aria-label={t("controls.fire")}>
          ●
        </button>
      </div>
    </div>
  );
}
