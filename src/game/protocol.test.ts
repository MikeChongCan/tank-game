import { expect, test } from "bun:test";
import { sanitizeName, sanitizeRoom } from "./protocol";
import { getSignalingUrl } from "../net/signaling";

test("room and name input are bounded and URL safe", () => {
  expect(sanitizeRoom(" QA Room!! ")).toBe("qa-room");
  expect(sanitizeName("  Commander   One  ")).toBe("Commander One");
  expect(sanitizeName("A\u200blice\u202e")).toBe("Alice");
  expect(sanitizeName("")).toBe("Player");
});

test("vite development pages default to local worker signaling", () => {
  expect(getSignalingUrl("alpha", "http://127.0.0.1:5173/?room=alpha")).toBe("ws://127.0.0.1:8787/api/rooms/alpha/signals");
});

test("deployed pages use same-origin websocket signaling", () => {
  expect(getSignalingUrl("main", "https://tank.example.com/play")).toBe("wss://tank.example.com/api/rooms/main/signals");
});
