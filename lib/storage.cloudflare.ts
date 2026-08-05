import { env } from "cloudflare:workers";
import type { GalleryRecord, Piece, PresenceRecord, RoomRecord, RoomSummary } from "./storage";

type RoomRow = Omit<RoomRecord, "pieces"> & { pieces: string };

const WIPE_MARKER = "system/rooms-wiped-2026-08-03";
let wipeChecked = false;
let nextCleanupAt = 0;

export async function ensureSchema() {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS puzzle_rooms (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    rows INTEGER NOT NULL,
    cols INTEGER NOT NULL,
    pieces TEXT NOT NULL,
    image_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  if (wipeChecked) return;
  if (await env.BUCKET.head(WIPE_MARKER)) {
    wipeChecked = true;
    return;
  }

  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: "puzzles/", cursor });
    if (page.objects.length > 0) await env.BUCKET.delete(page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.prepare("DELETE FROM puzzle_rooms").run();
  await env.BUCKET.put(WIPE_MARKER, String(Date.now()), { httpMetadata: { contentType: "text/plain" } });
  wipeChecked = true;
}

export async function getRoom(code: string): Promise<RoomRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM puzzle_rooms WHERE code = ?").bind(code).first<RoomRow>();
  return row ? { ...row, pieces: JSON.parse(row.pieces) as Piece[] } : null;
}

export async function roomExists(code: string) {
  return Boolean(await env.DB.prepare("SELECT code FROM puzzle_rooms WHERE code = ?").bind(code).first());
}

export async function createRoom(room: RoomRecord) {
  await env.DB.prepare("INSERT INTO puzzle_rooms (code, title, rows, cols, pieces, image_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(room.code, room.title, room.rows, room.cols, JSON.stringify(room.pieces), room.image_key, room.updated_at).run();
  return room;
}

export async function updateRoomPieces(code: string, pieces: Piece[], updatedAt: number) {
  await env.DB.prepare("UPDATE puzzle_rooms SET pieces = ?, updated_at = ? WHERE code = ?")
    .bind(JSON.stringify(pieces), updatedAt, code).run();
}

export async function touchRoomActivity(code: string, activeAt: number) {
  await env.DB.prepare("UPDATE puzzle_rooms SET updated_at = ? WHERE code = ?").bind(activeAt, code).run();
}

export async function deleteRoom(code: string, imageKey: string) {
  await env.BUCKET.delete(imageKey);
  await env.DB.prepare("DELETE FROM puzzle_rooms WHERE code = ?").bind(code).run();
}

export async function maybeCleanupExpiredRooms(cutoff: number) {
  const now = Date.now();
  if (now < nextCleanupAt) return;
  nextCleanupAt = now + 60_000;
  const result = await env.DB.prepare("SELECT code, image_key FROM puzzle_rooms WHERE updated_at < ? LIMIT 100")
    .bind(cutoff).all<{ code: string; image_key: string }>();
  for (const room of result.results) await deleteRoom(room.code, room.image_key);
}

export async function putPuzzleImage(code: string, body: ArrayBuffer, contentType: string) {
  const imageKey = `puzzles/${code}/original`;
  await env.BUCKET.put(imageKey, body, { httpMetadata: { contentType } });
  return imageKey;
}

export async function getPuzzleImageResponse(imageKey: string) {
  const object = await env.BUCKET.get(imageKey);
  if (!object) return null;
  const responseHeaders = new Headers();
  object.writeHttpMetadata(responseHeaders);
  responseHeaders.set("etag", object.httpEtag);
  responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers: responseHeaders });
}

export async function getGalleryPuzzles(): Promise<GalleryRecord[]> {
  return [];
}

export async function getGalleryPuzzle(_id: string): Promise<GalleryRecord | null> {
  return null;
}

export async function createGalleryPuzzle(puzzle: GalleryRecord): Promise<GalleryRecord> {
  return puzzle;
}

export async function putGalleryImage(id: string, body: ArrayBuffer, contentType: string) {
  const imageKey = `gallery/${id}/original`;
  await env.BUCKET.put(imageKey, body, { httpMetadata: { contentType } });
  return imageKey;
}

export async function deleteGalleryImage(imageKey: string) {
  await env.BUCKET.delete(imageKey);
}

export async function deleteGalleryPuzzle(_id: string) {
  return false;
}

export async function getGalleryImageResponse(_imageKey: string) {
  return new Response(null, { status: 404 });
}

export async function getPuzzleImageDownloadResponse(imageKey: string, filename: string) {
  const response = await getPuzzleImageResponse(imageKey);
  if (!response) return new Response(null, { status: 404 });
  const headers = new Headers(response.headers);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return new Response(response.body, { status: 200, headers });
}

export async function getRoomPresences(_roomCode: string, _cutoff: number): Promise<PresenceRecord[]> {
  return [];
}

export async function getActivePresences(_cutoff: number): Promise<PresenceRecord[]> {
  return [];
}

export async function getActiveUserCount(_cutoff: number) {
  return 0;
}

export async function touchPresence(_clientId: string, _roomCode: string | null, _lastSeenAt: number, _nickname?: string) {
  return true;
}

export async function removePresence(_clientId: string) {}

export async function revokePresence(_clientId: string, _revokedAt: number) {}

export async function broadcastRoomChange(_code: string, _change: { piece?: Piece; pieces?: Piece[]; updatedAt: number }) {}

export async function deletePuzzleImage(imageKey: string) {
  await env.BUCKET.delete(imageKey);
}

export async function getRoomSummaries(): Promise<RoomSummary[]> {
  const result = await env.DB.prepare("SELECT code, title, rows, cols, updated_at FROM puzzle_rooms ORDER BY updated_at DESC LIMIT 500").all<RoomSummary>();
  return result.results;
}
