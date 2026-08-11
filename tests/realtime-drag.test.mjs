import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseRoomActionMessage, parseRoomDragMessage } from "../lib/realtime-client.ts";

const root = new URL("../", import.meta.url);

test("live drag messages accept only bounded ephemeral coordinates", () => {
  const valid = {
    senderId: "sender_123456",
    gestureId: "gesture_123456",
    pieceId: 47,
    x: 0.42,
    y: 0.71,
    seq: 12,
    phase: "move",
  };
  assert.deepEqual(parseRoomDragMessage(valid), valid);
  assert.equal(parseRoomDragMessage({ ...valid, senderId: "short" }), null);
  assert.equal(parseRoomDragMessage({ ...valid, pieceId: 48 * 48 }), null);
  assert.equal(parseRoomDragMessage({ ...valid, x: Number.NaN }), null);
  assert.equal(parseRoomDragMessage({ ...valid, phase: "drop" }), null);
});

test("room actions accept only a bounded push-to-edges event", () => {
  const valid = {
    senderId: "sender_123456",
    actionId: "action_123456",
    seq: 13,
    action: "push-edges",
  };
  assert.deepEqual(parseRoomActionMessage(valid), valid);
  assert.equal(parseRoomActionMessage({ ...valid, actionId: "short" }), null);
  assert.equal(parseRoomActionMessage({ ...valid, action: "reset-room" }), null);
  assert.equal(parseRoomActionMessage({ ...valid, seq: -1 }), null);
});

test("live motion is throttled, bounded and never authoritative", async () => {
  const [page, realtime] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/realtime-client.ts", root), "utf8"),
  ]);
  assert.match(page, /LIVE_DRAG_INTERVAL_MS = 33/);
  assert.match(page, /REMOTE_MOVE_TRANSITION_MS = 90/);
  assert.match(page, /REMOTE_SETTLE_TRANSITION_MS = 110/);
  assert.match(page, /REMOTE_DRAG_TTL_MS = 2_500/);
  assert.match(page, /REMOTE_DROP_HANDOFF_MS = 2_500/);
  assert.match(page, /MAX_REMOTE_DRAGS = 16/);
  assert.match(realtime, /socket\.bufferedAmount > 64 \* 1024/);
  assert.match(realtime, /event: "piece-drag"/);
  assert.match(realtime, /event: "room-action"/);
  assert.match(page, /playerColor\(drag\.senderId\)/);
  assert.doesNotMatch(realtime, /playerName/);

  const start = page.indexOf("const applyRemoteDrag");
  const end = page.indexOf("\n\n    const applyRemoteAction", start);
  assert.ok(start >= 0 && end > start, "remote drag handler must remain inspectable");
  const handler = page.slice(start, end);
  assert.match(handler, /setRemoteDrags/);
  assert.match(handler, /expiresAt = Date\.now\(\) \+ REMOTE_DROP_HANDOFF_MS/);
  assert.doesNotMatch(handler, /refreshAuthoritativeRoom\(true\)/);
  assert.doesNotMatch(handler, /setPieces|remoteUpdatedAt\.current\s*=/);

  assert.match(page, /transform = `translate3d\(\$\{x\}px,\$\{y\}px,0\)`/);
  assert.match(page, /new ResizeObserver\(\(\) => positionRemotePuzzlePiece/);
  assert.match(page, /realtimeSubscriptionRef\.current \?\? drag\.subscription/);
  assert.match(page, /pendingLiveDragRef\.current = message/);
  assert.match(page, /pending && subscription\?\.sendDrag\(pending\)/);
  assert.doesNotMatch(page, /if \(!drag\.subscription \|\| !realtimeSenderId\.current\) return null/);

  const actionStart = page.indexOf("const applyRemoteAction");
  const actionEnd = page.indexOf("\n\n    void fetch(\"/api/realtime\")", actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart, "remote action handler must remain inspectable");
  const actionHandler = page.slice(actionStart, actionEnd);
  assert.match(actionHandler, /message\.action !== "push-edges"/);
  assert.match(actionHandler, /setPieces\(\(current\) =>/);
  assert.match(actionHandler, /piece\.locked \|\| piece\.zone !== "board"/);
  assert.match(page, /pendingRoomActionRef\.current = \{ message, expiresAt: Date\.now\(\) \+ 2_500 \}/);
});
