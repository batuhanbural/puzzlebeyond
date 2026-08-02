import { env } from "cloudflare:workers";
import type { Piece, RoomRecord } from "./storage";

type RoomRow = Omit<RoomRecord, "pieces"> & { pieces: string };

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
