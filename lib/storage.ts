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

export type GalleryRecord = {
  id: string;
  title: string;
  description: string;
  image_key: string;
  image_kind: "custom" | "sunset" | "garden" | "city";
  rows: number;
  cols: number;
  accent: string;
  created_at: number;
};

export type PresenceRecord = {
  client_id: string;
  room_code: string | null;
  last_seen_at: number;
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
  const markerDetail = await marker.text();
  const markerMissing = marker.status === 404 || (
    marker.status === 400 && /not[\s-]?found|resource was not found|does not exist/i.test(markerDetail)
  );
  if (!markerMissing) {
    throw new Error(`Oda temizleme durumu okunamadı (${marker.status}): ${markerDetail}`);
  }

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
  if (!saved.ok) throw new Error(`Oda temizleme durumu kaydedilemedi (${saved.status}): ${await saved.text()}`);
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

export async function deletePuzzleImage(imageKey: string) {
  await deleteStorageObject(imageKey);
}

export async function getPuzzleImageResponse(imageKey: string) {
  const { url, bucket } = config();
  return Response.redirect(`${url}/storage/v1/object/public/${bucket}/${imageKey}`, 307);
}

export async function getGalleryPuzzles() {
  const response = await dataRequest("gallery_puzzles?select=*&order=created_at.asc");
  return await response.json() as GalleryRecord[];
}

export async function getGalleryPuzzle(id: string) {
  const response = await dataRequest(`gallery_puzzles?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  const rows = await response.json() as GalleryRecord[];
  return rows[0] ?? null;
}

export async function createGalleryPuzzle(puzzle: Omit<GalleryRecord, "created_at"> & { created_at: number }) {
  const response = await dataRequest("gallery_puzzles", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(puzzle),
  });
  const rows = await response.json() as GalleryRecord[];
  if (!rows[0]) throw new Error("Supabase galeri kaydı oluşturulamadı.");
  return rows[0];
}

export async function putGalleryImage(id: string, body: ArrayBuffer, contentType: string) {
  const { url, bucket } = config();
  const imageKey = `gallery/${id}/original`;
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${imageKey}`, {
    method: "POST",
    headers: headers({ "Content-Type": contentType, "x-upsert": "true", "cache-control": "31536000" }),
    body,
  });
  if (!response.ok) throw new Error(`Supabase galeri görseli yüklenemedi (${response.status}): ${await response.text()}`);
  return imageKey;
}

async function deleteStorageObject(imageKey: string) {
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${imageKey}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Storage görseli silinemedi (${response.status}).`);
  }
}

export async function deleteGalleryImage(imageKey: string) {
  await deleteStorageObject(imageKey);
}

export async function deleteGalleryPuzzle(id: string) {
  const puzzle = await getGalleryPuzzle(id);
  if (!puzzle) return false;
  if (puzzle.image_kind === "custom") await deleteStorageObject(puzzle.image_key);
  await dataRequest(`gallery_puzzles?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  return true;
}

export async function getGalleryImageResponse(imageKey: string) {
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/public/${bucket}/${imageKey}`, { cache: "no-store" });
  if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 });
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function touchPresence(clientId: string, roomCode: string | null, lastSeenAt: number) {
  await dataRequest("site_presence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ client_id: clientId, room_code: roomCode, last_seen_at: lastSeenAt }),
  });
}

export async function removePresence(clientId: string) {
  await dataRequest(`site_presence?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function getActiveUserCount(cutoff: number) {
  const response = await dataRequest(`site_presence?last_seen_at=gt.${Math.floor(cutoff)}&select=client_id`);
  const rows = await response.json() as Array<{ client_id: string }>;
  return new Set(rows.map((row) => row.client_id)).size;
}
