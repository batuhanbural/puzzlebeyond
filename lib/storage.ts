export type Piece = { id: number; x: number; y: number; locked?: boolean };
export type RoomRecord = {
  code: string;
  title: string;
  rows: number;
  cols: number;
  pieces: Piece[];
  image_key: string;
  updated_at: number;
};

const WIPE_MARKER = "system/rooms-wiped-2026-08-03";
let wipeChecked = false;
let nextCleanupAt = 0;

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "puzzle-images";
  if (!url || !key) {
    throw new Error("Vercel için SUPABASE_URL ve SUPABASE_SECRET_KEY ortam değişkenleri gerekli.");
  }
  return { url, key, bucket };
}

function headers(extra?: HeadersInit) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

async function dataRequest(path: string, init?: RequestInit) {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: headers(init?.headers),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase veri isteği başarısız (${response.status}): ${detail}`);
  }
  return response;
}

function normalizeRoom(row: Omit<RoomRecord, "pieces"> & { pieces: Piece[] | string }): RoomRecord {
  return { ...row, pieces: typeof row.pieces === "string" ? JSON.parse(row.pieces) as Piece[] : row.pieces };
}

export async function ensureSchema() {
  config();
  if (wipeChecked) return;
  const { url, bucket } = config();
  const marker = await fetch(`${url}/storage/v1/object/${bucket}/${WIPE_MARKER}`, { headers: headers(), cache: "no-store" });
  if (marker.ok) {
    wipeChecked = true;
    return;
  }
  if (marker.status !== 404) throw new Error(`Oda temizleme durumu okunamadı (${marker.status}).`);

  const response = await dataRequest("puzzle_rooms?select=code,image_key");
  const rooms = await response.json() as Array<{ code: string; image_key: string }>;
  for (const room of rooms) {
    await deleteRoom(room.code, room.image_key);
  }
  const saved = await fetch(`${url}/storage/v1/object/${bucket}/${WIPE_MARKER}`, {
    method: "POST",
    headers: headers({ "Content-Type": "text/plain", "x-upsert": "true" }),
    body: new TextEncoder().encode(String(Date.now())),
  });
  if (!saved.ok) throw new Error(`Oda temizleme durumu kaydedilemedi (${saved.status}).`);
  wipeChecked = true;
}

export async function getRoom(code: string) {
  const response = await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  const rows = await response.json() as Array<Omit<RoomRecord, "pieces"> & { pieces: Piece[] | string }>;
  return rows[0] ? normalizeRoom(rows[0]) : null;
}

export async function roomExists(code: string) {
  const response = await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
  return ((await response.json()) as Array<{ code: string }>).length > 0;
}

export async function createRoom(room: RoomRecord) {
  const response = await dataRequest("puzzle_rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(room),
  });
  const rows = await response.json() as Array<Omit<RoomRecord, "pieces"> & { pieces: Piece[] | string }>;
  return normalizeRoom(rows[0]);
}

export async function updateRoomPieces(code: string, pieces: Piece[], updatedAt: number) {
  await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ pieces, updated_at: updatedAt }),
  });
}

export async function touchRoomActivity(code: string, activeAt: number) {
  await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ updated_at: activeAt }),
  });
}

export async function deleteRoom(code: string, imageKey: string) {
  const { url, bucket } = config();
  const imageResponse = await fetch(`${url}/storage/v1/object/${bucket}/${imageKey}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!imageResponse.ok && imageResponse.status !== 404) {
    throw new Error(`Oda görseli silinemedi (${imageResponse.status}).`);
  }
  await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function maybeCleanupExpiredRooms(cutoff: number) {
  const now = Date.now();
  if (now < nextCleanupAt) return;
  nextCleanupAt = now + 60_000;
  const response = await dataRequest(`puzzle_rooms?updated_at=lt.${cutoff}&select=code,image_key&limit=100`);
  const rooms = await response.json() as Array<{ code: string; image_key: string }>;
  for (const room of rooms) await deleteRoom(room.code, room.image_key);
}

export async function putPuzzleImage(code: string, body: ArrayBuffer, contentType: string) {
  const { url, bucket } = config();
  const imageKey = `puzzles/${code}/original`;
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${imageKey}`, {
    method: "POST",
    headers: headers({ "Content-Type": contentType, "x-upsert": "true", "cache-control": "31536000" }),
    body,
  });
  if (!response.ok) throw new Error(`Supabase görsel yüklemesi başarısız (${response.status}): ${await response.text()}`);
  return imageKey;
}

export async function getPuzzleImageResponse(imageKey: string) {
  const { url, bucket } = config();
  return Response.redirect(`${url}/storage/v1/object/public/${bucket}/${imageKey}`, 307);
}
