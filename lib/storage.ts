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

export type RoomSummary = Pick<RoomRecord, "code" | "title" | "rows" | "cols" | "updated_at">;

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
  revoked_at?: number | null;
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

export async function getRoomSummaries() {
  const response = await dataRequest("puzzle_rooms?select=code,title,rows,cols,updated_at&order=updated_at.desc&limit=500");
  return await response.json() as RoomSummary[];
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

export async function broadcastRoomChange(
  code: string,
  change: { piece?: Piece; pieces?: Piece[]; updatedAt: number },
) {
  // A public key is also the opt-in switch for the browser WebSocket. Keep
  // the legacy polling path untouched when a project has not configured it.
  if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY) return;
  const { url } = config();
  const topic = `puzzlebeyond-room-${code}`;
  const response = await fetch(`${url}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/piece-change`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ code, ...change }),
    cache: "no-store",
    signal: AbortSignal.timeout(1200),
  });
  if (!response.ok) {
    throw new Error(`Supabase Realtime yayını başarısız (${response.status}).`);
  }
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

export async function getPuzzleImageDownloadResponse(imageKey: string, filename: string) {
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/public/${bucket}/${imageKey}`, { cache: "no-store" });
  if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 });
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const safeBase = filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]/gi, "-");
  const safeFilename = `${safeBase}.${extension}`;
  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "no-store",
    },
  });
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
  const response = await dataRequest("site_presence", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({ client_id: clientId, room_code: roomCode, last_seen_at: lastSeenAt }),
  });
  const rows = await response.json() as Array<{ revoked_at?: number | null }>;
  return rows[0]?.revoked_at == null;
}

export async function removePresence(clientId: string) {
  const baseQuery = `site_presence?client_id=eq.${encodeURIComponent(clientId)}`;
  try {
    await dataRequest(`${baseQuery}&revoked_at=is.null`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch (error) {
    // Keep leave-beacon compatibility until the additive session migration is run.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("revoked_at")) throw error;
    await dataRequest(baseQuery, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
}

export async function revokePresence(clientId: string, revokedAt: number) {
  await dataRequest(`site_presence?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: revokedAt, room_code: null }),
  });
}

export async function getActivePresences(cutoff: number) {
  const query = `site_presence?last_seen_at=gt.${Math.floor(cutoff)}&select=client_id,room_code,last_seen_at&order=last_seen_at.desc`;
  try {
    const response = await dataRequest(`${query}&revoked_at=is.null`);
    return await response.json() as PresenceRecord[];
  } catch (error) {
    // Keep the admin panel usable until the additive session migration is run.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("revoked_at")) throw error;
    const response = await dataRequest(query);
    return await response.json() as PresenceRecord[];
  }
}

export async function getActiveUserCount(cutoff: number) {
  const rows = await getActivePresences(cutoff);
  return new Set(rows.map((row) => row.client_id)).size;
}
