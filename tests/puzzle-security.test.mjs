import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boardTarget,
  detectImageType,
  isValidRoomCode,
  NEW_ROOM_CODE_LENGTH,
  normalizePuzzlePiece,
  normalizePuzzlePieces,
  validateImageBytes,
} from "../lib/puzzle-validation.ts";
import {
  adminPasswordConfigured,
  adminSessionSecretConfigured,
  createAdminSession,
  isAdminRequest,
} from "../lib/admin-auth.ts";

const projectRoot = new URL("../", import.meta.url);

test("room codes are strictly six unambiguous characters", () => {
  assert.equal(NEW_ROOM_CODE_LENGTH, 6);
  assert.equal(isValidRoomCode("A7K2P9"), true);
  assert.equal(isValidRoomCode("A7K2P9XR"), false);
  assert.equal(isValidRoomCode("A7K2P9X"), false);
  assert.equal(isValidRoomCode("A7K2O9"), false, "ambiguous O is excluded");
  assert.equal(isValidRoomCode("A7K209"), false, "ambiguous 0 is excluded");
});

test("Supabase and D1 enforce six-character room codes", async () => {
  const [supabaseSchema, strictMigration, d1Schema, d1Migration, cloudflareStorage] = await Promise.all([
    readFile(new URL("supabase/schema.sql", projectRoot), "utf8"),
    readFile(new URL("supabase/migrations/007_strict_six_character_room_codes.sql", projectRoot), "utf8"),
    readFile(new URL("db/schema.ts", projectRoot), "utf8"),
    readFile(new URL("drizzle/0001_panoramic_clea.sql", projectRoot), "utf8"),
    readFile(new URL("lib/storage.cloudflare.ts", projectRoot), "utf8"),
  ]);

  assert.doesNotMatch(supabaseSchema, /\{8\}/, "the current Supabase schema must not allow eight-character codes");
  assert.match(strictMigration, /begin;[\s\S]*commit;/);
  assert.match(strictMigration, /set code = candidate/);
  assert.match(strictMigration, /site_presence_room_code_check/);
  assert.match(strictMigration, /foreign key \(room_code\) references public\.puzzle_rooms\(code\)/);
  assert.match(d1Schema, /length\(\$\{table\.code\}\) = 6/);
  assert.match(d1Migration, /CHECK\(length\("__new_puzzle_rooms"\."code"\) = 6/);
  assert.match(cloudflareStorage, /length\(code\) = 6/);
});

test("admin cookies use a dedicated high-entropy session secret", () => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  try {
    process.env.ADMIN_PASSWORD = "a-secure-admin-password";
    process.env.ADMIN_SESSION_SECRET = "session-secret-with-more-than-32-random-characters";
    assert.equal(adminPasswordConfigured(), true);
    assert.equal(adminSessionSecretConfigured(), true);
    const token = createAdminSession();
    const request = new Request("https://example.test/admin", { headers: { cookie: `parca_admin_session=${token}` } });
    assert.equal(isAdminRequest(request), true);
    process.env.ADMIN_PASSWORD = "a-different-admin-password";
    assert.equal(isAdminRequest(request), true, "password rotation does not expose or redefine the HMAC key");
    process.env.ADMIN_SESSION_SECRET = "another-session-secret-with-more-than-32-characters";
    assert.equal(isAdminRequest(request), false, "session-secret rotation revokes old cookies");
  } finally {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
  }
});

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("bulk piece validation requires one exact, finite piece per board cell", () => {
  const rows = 3;
  const cols = 4;
  const pieces = Array.from({ length: rows * cols }, (_, id) => ({ id, x: 0, y: 0, zone: "mat", locked: false }));
  const normalized = normalizePuzzlePieces(pieces, rows, cols);
  assert.equal(normalized?.length, rows * cols);
  assert.ok(normalized?.every((piece) => piece.zone === "mat" && piece.x === 0 && piece.y === 0));

  assert.equal(normalizePuzzlePieces(pieces.slice(1), rows, cols), null);
  assert.equal(normalizePuzzlePieces([...pieces.slice(0, -1), pieces[0]], rows, cols), null);
  assert.equal(normalizePuzzlePieces(pieces.map((piece) => piece.id === 2 ? { ...piece, x: Number.NaN } : piece), rows, cols), null);
  assert.equal(normalizePuzzlePieces(Array.from({ length: 48 * 48 }), 48, 48), null, "oversized boards are rejected before parsing each piece");
});

test("piece validation canonicalizes solved targets and rejects hidden board coordinates", () => {
  const target = boardTarget(11, 3, 4);
  assert.deepEqual(normalizePuzzlePiece({ id: 11, ...target, zone: "board", locked: true }, 3, 4), {
    id: 11,
    ...target,
    locked: true,
    layoutVersion: 3,
    zone: "board",
  });
  assert.equal(normalizePuzzlePiece({ id: 11, x: 1, y: 1, zone: "mat", locked: true }, 3, 4), null);
  assert.equal(normalizePuzzlePiece({ id: 1, x: 0.76, y: 0, zone: "board", locked: false }, 3, 4), null);
  assert.equal(normalizePuzzlePiece({ id: "1", x: 0, y: 0, zone: "board", locked: false }, 3, 4), null);
  assert.deepEqual(normalizePuzzlePiece({ id: 1, x: 0.4, y: 0.5, zone: "mat", positioned: true, locked: false }, 3, 4), {
    id: 1,
    x: 0.4,
    y: 0.5,
    locked: false,
    layoutVersion: 3,
    zone: "mat",
    positioned: true,
  });
  assert.deepEqual(normalizePuzzlePiece({ id: 1, x: 0.4, y: 0.5, zone: "mat", positioned: true, matLayout: "band", locked: false }, 3, 4), {
    id: 1,
    x: 0.4,
    y: 0.5,
    locked: false,
    layoutVersion: 3,
    zone: "mat",
    positioned: true,
    matLayout: "band",
  });
  assert.equal(normalizePuzzlePiece({ id: 1, x: 0.4, y: 0.5, zone: "mat", positioned: true, matLayout: "board", locked: false }, 3, 4), null);
  assert.equal(normalizePuzzlePiece({ id: 1, x: 0.99, y: 0.5, zone: "mat", positioned: true, locked: false }, 3, 4), null);
});

test("uploaded images require matching magic bytes and safe portrait dimensions", () => {
  const portrait = pngHeader(2160, 3840);
  assert.equal(detectImageType(portrait), "image/png");
  assert.deepEqual(validateImageBytes(portrait, "image/png"), {
    type: "image/png",
    width: 2160,
    height: 3840,
  });
  assert.equal(validateImageBytes(portrait, "image/jpeg"), null);
  assert.equal(validateImageBytes(pngHeader(100, 1000), "image/png"), null, "extreme aspect is rejected");
  assert.ok(validateImageBytes(pngHeader(6000, 4000), "image/png"), "24 megapixels remains supported");
  assert.equal(validateImageBytes(pngHeader(6000, 4001), "image/png"), null, "images above the mobile decode budget are rejected");
  assert.equal(validateImageBytes(pngHeader(8000, 8000), "image/png"), null, "decompression bombs are rejected by pixel count");
  const fakePng = portrait.slice();
  fakePng.set([0, 0, 0, 0], 12);
  assert.equal(validateImageBytes(fakePng, "image/png"), null, "IHDR must be present");
});
