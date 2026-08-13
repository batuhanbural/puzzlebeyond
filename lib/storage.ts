import { validateImageBytes, type MatLayout, type SupportedImageType } from "./puzzle-validation";
import { imageRequestNotModified, type ImageRequestConditions } from "./image-cache";

export type { ImageRequestConditions } from "./image-cache";

export type Piece = {
  id: number;
  x: number;
  y: number;
  locked?: boolean;
  layoutVersion?: number;
  zone?: "board" | "mat";
  positioned?: true;
  matLayout?: MatLayout;
};
export type RoomRecord = {
  code: string;
  title: string;
  rows: number;
  cols: number;
  pieces: Piece[];
  image_key: string;
  updated_at: number;
  last_active_at?: number;
};

export type RoomMetadata = Omit<RoomRecord, "pieces">;
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
  nickname?: string | null;
  last_seen_at: number;
  revoked_at?: number | null;
};

export type SafeImageContentType = SupportedImageType;

let nextCleanupAt = 0;
let lastActiveColumnAvailable: boolean | null = null;
let pieceRpcAvailable: boolean | null = null;

export function validateImageUpload(body: ArrayBuffer, claimedContentType: string): SafeImageContentType {
  const validated = validateImageBytes(new Uint8Array(body), claimedContentType);
  if (!validated) {
    throw new Error("Görsel içeriği yalnızca doğrulanmış JPG, PNG veya WebP olabilir.");
  }
  return validated.type;
}

function config() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "puzzle-images";
  if (!url || !key) {
    throw new Error("Vercel için SUPABASE_URL ve SUPABASE_SECRET_KEY ortam değişkenleri gerekli.");
  }
  return { url, key, bucket };
}

function headers(extra?: HeadersInit) {
  const { key } = config();
  // New sb_publishable/sb_secret keys are not JWTs and must only be sent in
  // the apikey header. Legacy anon/service_role JWTs still need Bearer auth.
  const result = new Headers(extra);
  result.set("apikey", key);
  if (key.startsWith("sb_")) result.delete("Authorization");
  else result.set("Authorization", `Bearer ${key}`);
  return result;
}

function encodedStoragePath(imageKey: string) {
  return imageKey.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function safeStoredImageType(value: string | null): SafeImageContentType | null {
  const normalized = value?.split(";", 1)[0].trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "image/jpeg") return "image/jpeg";
  if (normalized === "image/png" || normalized === "image/webp") return normalized;
  return null;
}

async function fetchPrivateStorageObject(imageKey: string, conditions?: ImageRequestConditions) {
  const { url, bucket } = config();
  const requestHeaders = headers();
  const ifNoneMatch = conditions?.ifNoneMatch?.trim();
  if (ifNoneMatch && ifNoneMatch.length <= 1_024) requestHeaders.set("If-None-Match", ifNoneMatch);
  const ifModifiedSince = conditions?.ifModifiedSince?.trim();
  if (ifModifiedSince && ifModifiedSince.length <= 128 && Number.isFinite(Date.parse(ifModifiedSince))) {
    requestHeaders.set("If-Modified-Since", ifModifiedSince);
  }
  return fetch(`${url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedStoragePath(imageKey)}`, {
    headers: requestHeaders,
    cache: "no-store",
  });
}

function imageResponseHeaders(
  upstream: Response,
  options: { cacheControl: string; disposition: "inline" | "attachment"; filename?: string },
) {
  const responseHeaders = new Headers({
    "Cache-Control": options.cacheControl,
    "Content-Disposition": options.filename
      ? `${options.disposition}; filename="${options.filename}"`
      : options.disposition,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
  const etag = upstream.headers.get("etag");
  if (etag) responseHeaders.set("ETag", etag);
  const lastModified = upstream.headers.get("last-modified");
  if (lastModified) responseHeaders.set("Last-Modified", lastModified);
  return responseHeaders;
}

function imageProxyResponse(
  upstream: Response,
  options: {
    cacheControl: string;
    disposition: "inline" | "attachment";
    filename?: string;
    conditions?: ImageRequestConditions;
  },
) {
  const responseHeaders = imageResponseHeaders(upstream, options);
  if (upstream.status === 304) return new Response(null, { status: 304, headers: responseHeaders });
  const contentType = safeStoredImageType(upstream.headers.get("content-type"));
  if (!contentType) {
    void upstream.body?.cancel();
    return new Response(null, {
      status: 415,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  responseHeaders.set("Content-Type", contentType);
  const etag = upstream.headers.get("etag");
  const lastModified = upstream.headers.get("last-modified");
  if (imageRequestNotModified(options.conditions, etag, lastModified)) {
    void upstream.body?.cancel();
    return new Response(null, { status: 304, headers: responseHeaders });
  }
  return new Response(upstream.body, { status: 200, headers: responseHeaders });
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

function missingLastActiveColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /last_active_at.*(does not exist|not found|schema cache)|column.*last_active_at/i.test(message);
}

function normalizeRoom(row: Omit<RoomRecord, "pieces"> & { pieces: Piece[] | string }): RoomRecord {
  lastActiveColumnAvailable = Object.prototype.hasOwnProperty.call(row, "last_active_at");
  return { ...row, pieces: typeof row.pieces === "string" ? JSON.parse(row.pieces) as Piece[] : row.pieces };
}

export function roomActivityAt(room: Pick<RoomRecord, "updated_at" | "last_active_at">) {
  return Number.isSafeInteger(room.last_active_at) ? room.last_active_at! : room.updated_at;
}

export async function ensureSchema() {
  // Schema migrations are deployment-time operations. Request handlers must
  // never mutate or wipe application data while checking configuration.
  config();
}

export async function getRoom(code: string) {
  const response = await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
  const rows = await response.json() as Array<Omit<RoomRecord, "pieces"> & { pieces: Piece[] | string }>;
  return rows[0] ? normalizeRoom(rows[0]) : null;
}

export async function getRoomMetadata(code: string) {
  const base = `puzzle_rooms?code=eq.${encodeURIComponent(code)}&limit=1`;
  if (lastActiveColumnAvailable !== false) {
    try {
      const response = await dataRequest(`${base}&select=code,title,rows,cols,image_key,updated_at,last_active_at`);
      const rows = await response.json() as RoomMetadata[];
      lastActiveColumnAvailable = true;
      return rows[0] ?? null;
    } catch (error) {
      if (!missingLastActiveColumn(error)) throw error;
      lastActiveColumnAvailable = false;
    }
  }
  const response = await dataRequest(`${base}&select=code,title,rows,cols,image_key,updated_at`);
  const rows = await response.json() as RoomMetadata[];
  return rows[0] ?? null;
}

export async function roomExists(code: string) {
  const response = await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}&select=code&limit=1`);
  return ((await response.json()) as Array<{ code: string }>).length > 0;
}

export async function getRoomSummaries() {
  if (lastActiveColumnAvailable !== false) {
    try {
      const response = await dataRequest("puzzle_rooms?select=code,title,rows,cols,updated_at,last_active_at&order=last_active_at.desc&limit=500");
      const rows = await response.json() as Array<RoomSummary & { last_active_at: number }>;
      lastActiveColumnAvailable = true;
      return rows.map(({ last_active_at, ...row }) => ({ ...row, updated_at: last_active_at }));
    } catch (error) {
      if (!missingLastActiveColumn(error)) throw error;
      lastActiveColumnAvailable = false;
    }
  }
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

export async function updateRoomPieces(code: string, pieces: Piece[], updatedAt: number, expectedUpdatedAt?: number) {
  const expected = expectedUpdatedAt === undefined ? "" : `&updated_at=eq.${Math.floor(expectedUpdatedAt)}`;
  const response = await dataRequest(`puzzle_rooms?code=eq.${encodeURIComponent(code)}${expected}&select=code`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      pieces,
      updated_at: updatedAt,
      ...(lastActiveColumnAvailable === true ? { last_active_at: updatedAt } : {}),
    }),
  });
  const rows = await response.json() as Array<{ code: string }>;
  return rows.length > 0;
}

export async function updateRoomPiece(code: string, piece: Piece, updatedAt: number, expectedUpdatedAt: number) {
  if (pieceRpcAvailable === false) return null;
  try {
    const response = await dataRequest("rpc/update_room_piece", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_code: code,
        next_piece: piece,
        next_updated_at: updatedAt,
        expected_updated_at: expectedUpdatedAt,
      }),
    });
    pieceRpcAvailable = true;
    return await response.json() === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/PGRST202|update_room_piece.*(schema cache|not find|does not exist)/i.test(message)) {
      pieceRpcAvailable = false;
      return null;
    }
    throw error;
  }
}

export async function broadcastRoomChange(
  code: string,
  change: { updatedAt: number },
) {
  // A public key is also the opt-in switch for the browser WebSocket. Keep
  // the legacy polling path untouched when a project has not configured it.
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!publicKey) return;
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

export async function touchRoomActivity(code: string, activeAt: number, staleBefore = activeAt) {
  const encodedCode = encodeURIComponent(code);
  if (lastActiveColumnAvailable !== false) {
    try {
      await dataRequest(`puzzle_rooms?code=eq.${encodedCode}&last_active_at=lt.${Math.floor(staleBefore)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ last_active_at: activeAt }),
      });
      lastActiveColumnAvailable = true;
      return;
    } catch (error) {
      if (!missingLastActiveColumn(error)) throw error;
      lastActiveColumnAvailable = false;
    }
  }
  await dataRequest(`puzzle_rooms?code=eq.${encodedCode}&updated_at=lt.${Math.floor(staleBefore)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ updated_at: activeAt }),
  });
}

export async function deleteRoom(code: string, imageKey: string) {
  const { url, bucket } = config();
  const imageResponse = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedStoragePath(imageKey)}`, {
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
  await ensureSchema();
  const now = Date.now();
  if (now < nextCleanupAt) return;
  nextCleanupAt = now + 60_000;
  let response: Response;
  if (lastActiveColumnAvailable !== false) {
    try {
      response = await dataRequest(`puzzle_rooms?last_active_at=lt.${Math.floor(cutoff)}&select=code,image_key&limit=25`);
      lastActiveColumnAvailable = true;
    } catch (error) {
      if (!missingLastActiveColumn(error)) throw error;
      lastActiveColumnAvailable = false;
      response = await dataRequest(`puzzle_rooms?updated_at=lt.${Math.floor(cutoff)}&select=code,image_key&limit=25`);
    }
  } else {
    response = await dataRequest(`puzzle_rooms?updated_at=lt.${Math.floor(cutoff)}&select=code,image_key&limit=25`);
  }
  const rooms = await response.json() as Array<{ code: string; image_key: string }>;
  for (let index = 0; index < rooms.length; index += 5) {
    await Promise.all(rooms.slice(index, index + 5).map((room) => deleteRoom(room.code, room.image_key)));
  }
}

export async function putPuzzleImage(code: string, body: ArrayBuffer, contentType: string) {
  const { url, bucket } = config();
  const verifiedContentType = validateImageUpload(body, contentType);
  const imageKey = `puzzles/${code}/${crypto.randomUUID()}`;
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedStoragePath(imageKey)}`, {
    method: "POST",
    headers: headers({ "Content-Type": verifiedContentType, "cache-control": "0" }),
    body,
  });
  if (!response.ok) throw new Error(`Supabase görsel yüklemesi başarısız (${response.status}): ${await response.text()}`);
  return imageKey;
}

export async function deletePuzzleImage(imageKey: string) {
  await deleteStorageObject(imageKey);
}

export async function getPuzzleImageResponse(imageKey: string, conditions?: ImageRequestConditions) {
  const response = await fetchPrivateStorageObject(imageKey, conditions);
  if (!response.ok && response.status !== 304) {
    void response.body?.cancel();
    return response.status === 404
      ? null
      : new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  return imageProxyResponse(response, {
    cacheControl: "private, max-age=300, must-revalidate",
    disposition: "inline",
    conditions,
  });
}

export async function getPuzzleImageDownloadResponse(imageKey: string, filename: string) {
  const response = await fetchPrivateStorageObject(imageKey);
  if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 });
  const contentType = safeStoredImageType(response.headers.get("content-type"));
  if (!contentType) {
    void response.body?.cancel();
    return new Response(null, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const safeBase = filename.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]/gi, "-");
  const safeFilename = `${safeBase}.${extension}`;
  return imageProxyResponse(response, {
    cacheControl: "private, no-store",
    disposition: "attachment",
    filename: safeFilename,
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
  const verifiedContentType = validateImageUpload(body, contentType);
  const imageKey = `gallery/${id}/original`;
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedStoragePath(imageKey)}`, {
    method: "POST",
    headers: headers({ "Content-Type": verifiedContentType, "x-upsert": "true", "cache-control": "3600" }),
    body,
  });
  if (!response.ok) throw new Error(`Supabase galeri görseli yüklenemedi (${response.status}): ${await response.text()}`);
  return imageKey;
}

async function deleteStorageObject(imageKey: string) {
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedStoragePath(imageKey)}`, {
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
  const response = await fetchPrivateStorageObject(imageKey);
  if (!response.ok) return new Response(null, { status: response.status === 404 ? 404 : 502 });
  return imageProxyResponse(response, {
    cacheControl: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    disposition: "inline",
  });
}

export async function touchPresence(clientId: string, roomCode: string | null, lastSeenAt: number, nickname = "Misafir") {
  const body = { client_id: clientId, room_code: roomCode, nickname, last_seen_at: lastSeenAt };
  try {
    const response = await dataRequest("site_presence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(body),
    });
    const rows = await response.json() as Array<{ revoked_at?: number | null }>;
    return rows[0]?.revoked_at == null;
  } catch (error) {
    // Keep old deployments alive until the nickname migration is applied.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("nickname")) throw error;
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

export async function deleteStalePresences(cutoff: number) {
  try {
    await dataRequest(`site_presence?last_seen_at=lt.${Math.floor(cutoff)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/site_presence.*(does not exist|not found)|relation.*site_presence/i.test(message)) throw error;
  }
}

export async function revokePresence(clientId: string, revokedAt: number) {
  await dataRequest(`site_presence?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ revoked_at: revokedAt, room_code: null }),
  });
}

export async function getRoomPresences(roomCode: string, cutoff: number) {
  const query = `site_presence?last_seen_at=gt.${Math.floor(cutoff)}&room_code=eq.${encodeURIComponent(roomCode)}&select=client_id,room_code,nickname,last_seen_at&order=last_seen_at.desc&limit=100`;
  return await dataRequest(`${query}&revoked_at=is.null`).then(res => res.json()) as PresenceRecord[];
}

export async function getActivePresences(cutoff: number) {
  const query = `site_presence?last_seen_at=gt.${Math.floor(cutoff)}&select=client_id,room_code,nickname,last_seen_at&order=last_seen_at.desc&limit=500`;
  try {
    const response = await dataRequest(`${query}&revoked_at=is.null`);
    return await response.json() as PresenceRecord[];
  } catch (error) {
    // Keep the admin panel usable until the additive session migration is run.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("nickname")) {
      const legacyQuery = `site_presence?last_seen_at=gt.${Math.floor(cutoff)}&select=client_id,room_code,last_seen_at&order=last_seen_at.desc`;
      try {
        const response = await dataRequest(`${legacyQuery}&revoked_at=is.null`);
        return (await response.json() as PresenceRecord[]).map((row) => ({ ...row, nickname: "Misafir" }));
      } catch (legacyError) {
        const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
        if (!legacyMessage.includes("revoked_at")) throw legacyError;
        const response = await dataRequest(legacyQuery);
        return (await response.json() as PresenceRecord[]).map((row) => ({ ...row, nickname: "Misafir" }));
      }
    }
    if (!message.includes("revoked_at")) throw error;
    const response = await dataRequest(query);
    return await response.json() as PresenceRecord[];
  }
}
