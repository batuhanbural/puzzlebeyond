import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  imageEtagMatches,
  imageRequestNotModified,
} from "../lib/image-cache.ts";

const root = new URL("../", import.meta.url);

test("image validators implement weak ETag matching and HTTP-date precedence", () => {
  assert.equal(imageEtagMatches('W/"abc"', '"abc"'), true);
  assert.equal(imageEtagMatches('"old", "abc"', 'W/"abc"'), true);
  assert.equal(imageEtagMatches("*", '"abc"'), true);
  assert.equal(imageEtagMatches('"old"', '"abc"'), false);

  const modified = "Sun, 09 Aug 2026 12:00:00 GMT";
  assert.equal(imageRequestNotModified({ ifModifiedSince: modified }, '"abc"', modified), true);
  assert.equal(imageRequestNotModified({ ifModifiedSince: "Sun, 09 Aug 2026 11:59:59 GMT" }, '"abc"', modified), false);
  assert.equal(imageRequestNotModified({ ifNoneMatch: '"old"', ifModifiedSince: "Sun, 09 Aug 2026 13:00:00 GMT" }, '"abc"', modified), false);
});

test("hot API paths avoid full pieces reads and request-time cleanup", async () => {
  const [roomRoute, presenceRoute, imageRoute, storage, cloudflareStorage] = await Promise.all([
    readFile(new URL("app/api/room/route.ts", root), "utf8"),
    readFile(new URL("app/api/presence/route.ts", root), "utf8"),
    readFile(new URL("app/api/image/route.ts", root), "utf8"),
    readFile(new URL("lib/storage.ts", root), "utf8"),
    readFile(new URL("lib/storage.cloudflare.ts", root), "utf8"),
  ]);

  assert.match(roomRoute, /if \(since > 0\)[\s\S]*getRoomMetadata\(code\)[\s\S]*status: 204/);
  assert.doesNotMatch(roomRoute, /maybeCleanupExpiredRooms/);
  assert.match(presenceRoute, /getRoomMetadata\(roomCode\)/);
  assert.doesNotMatch(presenceRoute, /\bgetRoom\(/);
  assert.match(imageRoute, /getRoomMetadata\(code\)/);
  assert.doesNotMatch(imageRoute, /\bgetRoom\(/);
  assert.match(storage, /select=code,title,rows,cols,image_key,updated_at,last_active_at/);
  assert.match(storage, /Number\.isSafeInteger\(room\.last_active_at\) \? room\.last_active_at! : room\.updated_at/);
  assert.match(cloudflareStorage, /code, title, rows, cols, image_key, updated_at/);
});

test("single-piece updates and background wake hints stay CAS constrained", async () => {
  const [roomRoute, storage, cloudflareStorage, migration] = await Promise.all([
    readFile(new URL("app/api/room/route.ts", root), "utf8"),
    readFile(new URL("lib/storage.ts", root), "utf8"),
    readFile(new URL("lib/storage.cloudflare.ts", root), "utf8"),
    readFile(new URL("supabase/migrations/006_room_activity_and_piece_rpc.sql", root), "utf8"),
  ]);

  assert.match(roomRoute, /updateRoomPiece\(code, movedPiece, updatedAt, room\.updated_at\)/);
  assert.match(roomRoute, /after\(async \(\) =>[\s\S]*broadcastRoomChange\(code, \{ updatedAt \}\)/);
  assert.match(storage, /rpc\/update_room_piece/);
  assert.match(cloudflareStorage, /json_set\(pieces[\s\S]*WHERE code = \? AND updated_at = \?/);
  assert.match(migration, /room\.updated_at = expected_updated_at/);
  assert.match(migration, /coalesce\(room\.pieces -> piece_id -> 'locked',[\s\S]*<> 'true'::jsonb/);
  assert.match(migration, /revoke all on function public\.update_room_piece[\s\S]*from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.update_room_piece[\s\S]*to service_role/);
});
