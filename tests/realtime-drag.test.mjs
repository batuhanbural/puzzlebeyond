import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseRoomDragMessage } from "../lib/realtime-client.ts";

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

test("live motion is throttled, bounded and never authoritative", async () => {
  const [page, realtime] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("lib/realtime-client.ts", root), "utf8"),
  ]);
  assert.match(page, /LIVE_DRAG_INTERVAL_MS = 50/);
  assert.match(page, /REMOTE_DRAG_TTL_MS = 2_500/);
  assert.match(page, /REMOTE_DROP_HANDOFF_MS = 1_200/);
  assert.match(page, /MAX_REMOTE_DRAGS = 16/);
  assert.match(realtime, /socket\.bufferedAmount > 64 \* 1024/);
  assert.match(realtime, /event: "piece-drag"/);

  const start = page.indexOf("const applyRemoteDrag");
  const end = page.indexOf("\n\n    void fetch(\"/api/realtime\")", start);
  assert.ok(start >= 0 && end > start, "remote drag handler must remain inspectable");
  const handler = page.slice(start, end);
  assert.match(handler, /setRemoteDrags/);
  assert.match(handler, /refreshAuthoritativeRoom\(true\)/);
  assert.match(handler, /expiresAt = Date\.now\(\) \+ REMOTE_DROP_HANDOFF_MS/);
  assert.doesNotMatch(handler, /setPieces|remoteUpdatedAt\.current\s*=/);
});
