import { env } from "cloudflare:workers";
import { imageRequestNotModified, type ImageRequestConditions } from "./image-cache";
import { validateImageBytes, type SupportedImageType } from "./puzzle-validation";
import type {
  GalleryRecord,
  Piece,
  PresenceRecord,
  RoomMetadata,
  RoomRecord,
  RoomSummary,
} from "./storage";

type RoomRow = Omit<RoomRecord, "pieces"> & { pieces: string };
type ConditionalR2Object = {
  body?: ReadableStream;
  httpEtag: string;
  uploaded?: Date;
  writeHttpMetadata(headers: Headers): void;
};
type ConditionalR2Bucket = {
  get(key: string, options?: { onlyIf?: Headers }): Promise<ConditionalR2Object | null>;
};

export type SafeImageContentType = SupportedImageType;

let nextCleanupAt = 0;
let schemaReady: Promise<void> | null = null;
let lastActiveColumnAvailable = false;

export function validateImageUpload(body: ArrayBuffer, claimedContentType: string): SafeImageContentType {
  const validated = validateImageBytes(new Uint8Array(body), claimedContentType);
  if (!validated) {
    throw new Error("Görsel içeriği yalnızca doğrulanmış JPG, PNG veya WebP olabilir.");
  }
  return validated.type;
}

function safeStoredImageType(value: string | null): SafeImageContentType | null {
  const normalized = value?.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/jpeg") return "image/jpeg";
  if (normalized === "image/png" || normalized === "image/webp") return normalized;
  return null;
}

async function initializeSchema() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS puzzle_rooms (
    code TEXT PRIMARY KEY CHECK (
      length(code) = 6
      AND code NOT GLOB '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*'
    ),
    title TEXT NOT NULL,
    rows INTEGER NOT NULL,
    cols INTEGER NOT NULL,
    pieces TEXT NOT NULL,
    image_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  )`).run();
  const columns = await env.DB.prepare("PRAGMA table_info(puzzle_rooms)").all<{ name: string }>();
  lastActiveColumnAvailable = columns.results.some((column) => column.name === "last_active_at");
  if (!lastActiveColumnAvailable) {
    try {
      await env.DB.prepare("ALTER TABLE puzzle_rooms ADD COLUMN last_active_at INTEGER").run();
      await env.DB.prepare("UPDATE puzzle_rooms SET last_active_at = updated_at WHERE last_active_at IS NULL").run();
      lastActiveColumnAvailable = true;
    } catch (error) {
      // Another isolate may have won the additive migration race.
      const refreshed = await env.DB.prepare("PRAGMA table_info(puzzle_rooms)").all<{ name: string }>();
      lastActiveColumnAvailable = refreshed.results.some((column) => column.name === "last_active_at");
      if (!lastActiveColumnAvailable) {
        // Older/read-only D1 bindings keep the legacy updated_at TTL behavior.
        console.warn("D1 last_active_at migration could not be applied; using legacy activity timestamps.", error);
      }
    }
  }
  if (lastActiveColumnAvailable) {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS puzzle_rooms_last_active_at_idx ON puzzle_rooms (last_active_at)").run();
  }
  await env.DB.prepare("PRAGMA optimize").run();
}

export async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = initializeSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function getRoom(code: string): Promise<RoomRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM puzzle_rooms WHERE code = ?").bind(code).first<RoomRow>();
  return row ? { ...row, pieces: JSON.parse(row.pieces) as Piece[] } : null;
}

export function roomActivityAt(room: Pick<RoomRecord, "updated_at" | "last_active_at">) {
  return Number.isSafeInteger(room.last_active_at) ? room.last_active_at! : room.updated_at;
}

export async function getRoomMetadata(code: string): Promise<RoomMetadata | null> {
  const fields = lastActiveColumnAvailable
    ? "code, title, rows, cols, image_key, updated_at, last_active_at"
    : "code, title, rows, cols, image_key, updated_at";
  return await env.DB.prepare(`SELECT ${fields} FROM puzzle_rooms WHERE code = ?`)
    .bind(code).first<RoomMetadata>();
}

export async function roomExists(code: string) {
  return Boolean(await env.DB.prepare("SELECT code FROM puzzle_rooms WHERE code = ?").bind(code).first());
}

export async function createRoom(room: RoomRecord) {
  if (lastActiveColumnAvailable) {
    await env.DB.prepare("INSERT INTO puzzle_rooms (code, title, rows, cols, pieces, image_key, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(room.code, room.title, room.rows, room.cols, JSON.stringify(room.pieces), room.image_key, room.updated_at, room.updated_at).run();
    return { ...room, last_active_at: room.updated_at };
  }
  await env.DB.prepare("INSERT INTO puzzle_rooms (code, title, rows, cols, pieces, image_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(room.code, room.title, room.rows, room.cols, JSON.stringify(room.pieces), room.image_key, room.updated_at).run();
  return room;
}

export async function updateRoomPieces(code: string, pieces: Piece[], updatedAt: number, expectedUpdatedAt?: number) {
  const pieceJson = JSON.stringify(pieces);
  const result = lastActiveColumnAvailable
    ? expectedUpdatedAt === undefined
      ? await env.DB.prepare("UPDATE puzzle_rooms SET pieces = ?, updated_at = ?, last_active_at = ? WHERE code = ?")
        .bind(pieceJson, updatedAt, updatedAt, code).run()
      : await env.DB.prepare("UPDATE puzzle_rooms SET pieces = ?, updated_at = ?, last_active_at = ? WHERE code = ? AND updated_at = ?")
        .bind(pieceJson, updatedAt, updatedAt, code, expectedUpdatedAt).run()
    : expectedUpdatedAt === undefined
      ? await env.DB.prepare("UPDATE puzzle_rooms SET pieces = ?, updated_at = ? WHERE code = ?")
        .bind(pieceJson, updatedAt, code).run()
      : await env.DB.prepare("UPDATE puzzle_rooms SET pieces = ?, updated_at = ? WHERE code = ? AND updated_at = ?")
        .bind(pieceJson, updatedAt, code, expectedUpdatedAt).run();
  return Number(result.meta.changes) > 0;
}

export async function updateRoomPiece(code: string, piece: Piece, updatedAt: number, expectedUpdatedAt: number) {
  const pieceJson = JSON.stringify(piece);
  const activityAssignment = lastActiveColumnAvailable ? ", last_active_at = ?" : "";
  const statement = env.DB.prepare(`UPDATE puzzle_rooms
    SET pieces = json_set(pieces, '$[' || ? || ']', json(?)), updated_at = ?${activityAssignment}
    WHERE code = ? AND updated_at = ?
      AND json_valid(pieces)
      AND json_array_length(pieces) > ?
      AND json_extract(pieces, '$[' || ? || '].id') = ?
      AND COALESCE(json_extract(pieces, '$[' || ? || '].locked'), 0) <> 1`);
  const values = [piece.id, pieceJson, updatedAt];
  if (lastActiveColumnAvailable) values.push(updatedAt);
  values.push(code, expectedUpdatedAt, piece.id, piece.id, piece.id, piece.id);
  const result = await statement.bind(...values).run();
  return Number(result.meta.changes) > 0;
}

export async function touchRoomActivity(code: string, activeAt: number, staleBefore = activeAt) {
  if (lastActiveColumnAvailable) {
    await env.DB.prepare("UPDATE puzzle_rooms SET last_active_at = ? WHERE code = ? AND last_active_at < ?")
      .bind(activeAt, code, staleBefore).run();
    return;
  }
  await env.DB.prepare("UPDATE puzzle_rooms SET updated_at = ? WHERE code = ? AND updated_at < ?")
    .bind(activeAt, code, staleBefore).run();
}

export async function deleteRoom(code: string, imageKey: string) {
  await env.BUCKET.delete(imageKey);
  await env.DB.prepare("DELETE FROM puzzle_rooms WHERE code = ?").bind(code).run();
}

export async function maybeCleanupExpiredRooms(cutoff: number) {
  await ensureSchema();
  const now = Date.now();
  if (now < nextCleanupAt) return;
  nextCleanupAt = now + 60_000;
  const activityColumn = lastActiveColumnAvailable ? "last_active_at" : "updated_at";
  const result = await env.DB.prepare(`SELECT code, image_key FROM puzzle_rooms WHERE ${activityColumn} < ? LIMIT 25`)
    .bind(cutoff).all<{ code: string; image_key: string }>();
  if (result.results.length === 0) return;
  await env.BUCKET.delete(result.results.map((room) => room.image_key));
  await env.DB.batch(result.results.map((room) => env.DB.prepare("DELETE FROM puzzle_rooms WHERE code = ?").bind(room.code)));
}

export async function putPuzzleImage(code: string, body: ArrayBuffer, contentType: string) {
  const verifiedContentType = validateImageUpload(body, contentType);
  const imageKey = `puzzles/${code}/${crypto.randomUUID()}`;
  await env.BUCKET.put(imageKey, body, { httpMetadata: { contentType: verifiedContentType } });
  return imageKey;
}

export async function getPuzzleImageResponse(imageKey: string, conditions?: ImageRequestConditions) {
  const conditionHeaders = new Headers();
  const ifNoneMatch = conditions?.ifNoneMatch?.trim();
  if (ifNoneMatch && ifNoneMatch.length <= 1_024) conditionHeaders.set("If-None-Match", ifNoneMatch);
  const ifModifiedSince = conditions?.ifModifiedSince?.trim();
  if (ifModifiedSince && ifModifiedSince.length <= 128 && Number.isFinite(Date.parse(ifModifiedSince))) {
    conditionHeaders.set("If-Modified-Since", ifModifiedSince);
  }
  const bucket = env.BUCKET as unknown as ConditionalR2Bucket;
  const hasConditions = conditionHeaders.has("If-None-Match") || conditionHeaders.has("If-Modified-Since");
  const object = await bucket.get(imageKey, hasConditions ? { onlyIf: conditionHeaders } : undefined);
  if (!object) return null;
  const responseHeaders = new Headers();
  object.writeHttpMetadata(responseHeaders);
  const contentType = safeStoredImageType(responseHeaders.get("content-type"));
  if (!contentType) {
    await object.body?.cancel();
    return new Response(null, {
      status: 415,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const uploaded = object.uploaded;
  const lastModified = uploaded instanceof Date ? uploaded.toUTCString() : null;
  responseHeaders.set("Content-Type", contentType);
  responseHeaders.set("etag", object.httpEtag);
  if (lastModified) responseHeaders.set("Last-Modified", lastModified);
  responseHeaders.set("Cache-Control", "private, max-age=300, must-revalidate");
  responseHeaders.set("Content-Disposition", "inline");
  responseHeaders.set("Content-Security-Policy", "default-src 'none'; sandbox");
  responseHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  if (!object.body) return new Response(null, { status: 304, headers: responseHeaders });
  if (imageRequestNotModified(conditions, object.httpEtag, lastModified)) {
    await object.body.cancel();
    return new Response(null, { status: 304, headers: responseHeaders });
  }
  return new Response(object.body, { headers: responseHeaders });
}

export async function getGalleryPuzzles(): Promise<GalleryRecord[]> {
  return [];
}

export async function getGalleryPuzzle(_id: string): Promise<GalleryRecord | null> {
  void _id;
  return null;
}

export async function createGalleryPuzzle(puzzle: GalleryRecord): Promise<GalleryRecord> {
  return puzzle;
}

export async function putGalleryImage(id: string, body: ArrayBuffer, contentType: string) {
  const verifiedContentType = validateImageUpload(body, contentType);
  const imageKey = `gallery/${id}/original`;
  await env.BUCKET.put(imageKey, body, { httpMetadata: { contentType: verifiedContentType } });
  return imageKey;
}

export async function deleteGalleryImage(imageKey: string) {
  await env.BUCKET.delete(imageKey);
}

export async function deleteGalleryPuzzle(_id: string) {
  void _id;
  return false;
}

export async function getGalleryImageResponse(_imageKey: string) {
  void _imageKey;
  return new Response(null, { status: 404 });
}

export async function getPuzzleImageDownloadResponse(imageKey: string, filename: string) {
  const response = await getPuzzleImageResponse(imageKey);
  if (!response) return new Response(null, { status: 404 });
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  const contentType = safeStoredImageType(headers.get("content-type")) || "image/jpeg";
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const safeBase = filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]/gi, "-");
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", `attachment; filename="${safeBase}.${extension}"`);
  return new Response(response.body, { status: 200, headers });
}

export async function getRoomPresences(_roomCode: string, _cutoff: number): Promise<PresenceRecord[]> {
  void _roomCode;
  void _cutoff;
  return [];
}

export async function getActivePresences(_cutoff: number): Promise<PresenceRecord[]> {
  void _cutoff;
  return [];
}

export async function touchPresence(_clientId: string, _roomCode: string | null, _lastSeenAt: number, _nickname?: string) {
  void _clientId;
  void _roomCode;
  void _lastSeenAt;
  void _nickname;
  return true;
}

export async function removePresence(_clientId: string) { void _clientId; }

export async function deleteStalePresences(_cutoff: number) { void _cutoff; }

export async function revokePresence(_clientId: string, _revokedAt: number) { void _clientId; void _revokedAt; }

export async function broadcastRoomChange(_code: string, _change: { updatedAt: number }) { void _code; void _change; }

export async function deletePuzzleImage(imageKey: string) {
  await env.BUCKET.delete(imageKey);
}

export async function getRoomSummaries(): Promise<RoomSummary[]> {
  const activityExpression = lastActiveColumnAvailable ? "last_active_at" : "updated_at";
  const result = await env.DB.prepare(`SELECT code, title, rows, cols, ${activityExpression} AS updated_at FROM puzzle_rooms ORDER BY ${activityExpression} DESC LIMIT 500`).all<RoomSummary>();
  return result.results;
}
