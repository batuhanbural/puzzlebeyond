import {
  createRoom as storeRoom,
  deleteRoom,
  deletePuzzleImage,
  broadcastRoomChange,
  ensureSchema,
  getRoom,
  getRoomMetadata,
  putPuzzleImage,
  roomActivityAt,
  roomExists,
  touchRoomActivity,
  updateRoomPiece,
  updateRoomPieces,
  type Piece,
  type RoomRecord,
} from "@/lib/storage";
import { randomInt } from "node:crypto";
import { after } from "next/server";
import {
  MAX_IMAGE_BYTES,
  MAX_PUZZLE_PIECES,
  NEW_ROOM_CODE_LENGTH,
  PUZZLE_LAYOUT_VERSION,
  boardTarget,
  isValidRoomCode,
  normalizePuzzlePiece,
  normalizePuzzlePieces,
  parseGridDimension,
  validateImageBytes,
} from "@/lib/puzzle-validation";
import { allowRequest, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVITY_TOUCH_INTERVAL_MS = 60 * 1000;
const MAX_ROOM_REQUEST_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;
const MAX_PATCH_REQUEST_BYTES = 512 * 1024;

function makeCode() {
  return Array.from({ length: NEW_ROOM_CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
}

function canonicalStoredPieces(row: RoomRecord): Piece[] {
  const count = row.rows * row.cols;
  const byId = new Map<number, Piece>();
  for (const piece of Array.isArray(row.pieces) ? row.pieces : []) {
    if (Number.isSafeInteger(piece?.id) && piece.id >= 0 && piece.id < count && !byId.has(piece.id)) byId.set(piece.id, piece);
  }
  return Array.from({ length: count }, (_, id) => {
    const piece = byId.get(id);
    if (piece?.locked) {
      return { id, ...boardTarget(id, row.rows, row.cols), locked: true, layoutVersion: PUZZLE_LAYOUT_VERSION, zone: "board" };
    }
    return normalizePuzzlePiece(piece ?? { id, x: 0, y: 0, zone: "mat", locked: false }, row.rows, row.cols)
      ?? { id, x: 0, y: 0, locked: false, layoutVersion: PUZZLE_LAYOUT_VERSION, zone: "mat" };
  });
}

function roomJson(row: RoomRecord) {
  return {
    code: row.code,
    title: row.title,
    rows: row.rows,
    cols: row.cols,
    pieces: canonicalStoredPieces(row),
    imageUrl: `/api/image?code=${row.code}`,
    updatedAt: row.updated_at,
  };
}

function uploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("SUPABASE_URL")) return "Vercel Supabase ortam değişkenleri eksik. SUPABASE_URL ve SUPABASE_SECRET_KEY ayarlarını kontrol et.";
  if (/görsel yüklemesi başarısız \((401|403)\)/i.test(message)) return "Supabase anahtarı yükleme yetkisine sahip değil. SUPABASE_SECRET_KEY olarak service/secret key kullan.";
  if (/görsel yüklemesi başarısız \(404\)/i.test(message)) return "Supabase Storage bucket bulunamadı. puzzle-images bucket'ını oluştur veya SUPABASE_STORAGE_BUCKET değerini kontrol et.";
  if (/puzzle_rooms.*does not exist|relation.*puzzle_rooms.*not exist/i.test(message)) return "Supabase puzzle_rooms tablosu bulunamadı. supabase/schema.sql dosyasını SQL Editor'da çalıştır.";
  if (/puzzle_rooms/i.test(message)) return "Supabase puzzle_rooms tablosunda hata oluştu. supabase/schema.sql dosyasını SQL Editor'da tekrar çalıştırıp CHECK kısıtlamalarını güncelle.";
  if (/fetch failed|network|timeout/i.test(message)) return "Supabase'e bağlanılamadı. Vercel ortam değişkenleri ve Supabase URL'sini kontrol et.";
  return "Fotoğraf yüklenemedi. Dosya biçimini ve Supabase ayarlarını kontrol edip tekrar dene.";
}

export async function GET(request: Request) {
  if (!allowRequest(request, "room-read", 240, 60_000)) return rateLimitedResponse();
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  const requestedSince = Number(url.searchParams.get("since") || 0);
  const since = Number.isSafeInteger(requestedSince) && requestedSince > 0 ? requestedSince : 0;
  if (!code || !isValidRoomCode(code)) return Response.json({ error: "Geçerli bir oda kodu gerekli." }, { status: 400 });
  await ensureSchema();
  const now = Date.now();
  if (since > 0) {
    const metadata = await getRoomMetadata(code);
    if (!metadata) return Response.json({ error: "Bu kodla bir oda bulunamadı." }, { status: 404 });
    const metadataActivityAt = roomActivityAt(metadata);
    if (now - metadataActivityAt >= ROOM_TTL_MS) {
      await deleteRoom(metadata.code, metadata.image_key);
      return Response.json({ error: "Bu odanın süresi dolmuş." }, { status: 404 });
    }
    const staleBefore = now - ACTIVITY_TOUCH_INTERVAL_MS;
    if (metadataActivityAt < staleBefore) {
      await touchRoomActivity(metadata.code, now, staleBefore);
      // Legacy schemas use updated_at for both activity and state version.
      if (!Number.isSafeInteger(metadata.last_active_at)) metadata.updated_at = now;
    }
    if (metadata.updated_at <= since) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
  }

  const room = await getRoom(code);
  if (!room) return Response.json({ error: "Bu kodla bir oda bulunamadı." }, { status: 404 });
  const activityAt = roomActivityAt(room);
  if (now - activityAt >= ROOM_TTL_MS) {
    await deleteRoom(room.code, room.image_key);
    return Response.json({ error: "Bu odanın süresi dolmuş." }, { status: 404 });
  }
  const staleBefore = now - ACTIVITY_TOUCH_INTERVAL_MS;
  if (activityAt < staleBefore) {
    await touchRoomActivity(room.code, now, staleBefore);
    if (!Number.isSafeInteger(room.last_active_at)) room.updated_at = now;
    else room.last_active_at = now;
  }
  return Response.json({ room: roomJson(room) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!allowRequest(request, "room-create", 8, 10 * 60_000)) return rateLimitedResponse();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_ROOM_REQUEST_BYTES) {
    return Response.json({ error: "Yükleme isteği çok büyük." }, { status: 413 });
  }
  let imageKey = "";
  let roomSaved = false;
  try {
    await ensureSchema();
    const form = await request.formData();
    const title = String(form.get("title") || "Bizim puzzle").trim().replace(/\s+/g, " ").slice(0, 48) || "Bizim puzzle";
    const rows = parseGridDimension(form.get("rows"));
    const cols = parseGridDimension(form.get("cols"));
    if (!rows || !cols) return Response.json({ error: "Puzzle boyutu geçersiz." }, { status: 400 });
    if (rows * cols > MAX_PUZZLE_PIECES) return Response.json({ error: `Puzzle en fazla ${MAX_PUZZLE_PIECES} parça olabilir.` }, { status: 400 });
    let rawPieces: unknown;
    try {
      rawPieces = JSON.parse(String(form.get("pieces") || "[]"));
    } catch {
      return Response.json({ error: "Parça verisi okunamadı." }, { status: 400 });
    }
    const pieces = normalizePuzzlePieces(rawPieces, rows, cols);
    if (!pieces) return Response.json({ error: "Parça verisi geçersiz veya eksik." }, { status: 400 });
    const file = form.get("image");
    const defaultImage = String(form.get("defaultImage") || "");
    let imageBody: ArrayBuffer;
    let claimedType = "image/jpeg";
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "Fotoğraf en fazla 4 MB olabilir." }, { status: 413 });
      claimedType = file.type;
      imageBody = await file.arrayBuffer();
    } else {
      const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-z0-9+/=\s]+)$/i.exec(defaultImage);
      if (!match || match[2].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
        return Response.json({ error: "Bir JPG, PNG veya WebP fotoğraf seçmelisin." }, { status: 400 });
      }
      claimedType = match[1];
      try {
        const decoded = Buffer.from(match[2], "base64");
        imageBody = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer;
      } catch {
        return Response.json({ error: "Fotoğraf verisi okunamadı." }, { status: 400 });
      }
    }
    const validatedImage = validateImageBytes(new Uint8Array(imageBody), claimedType);
    if (!validatedImage) {
      return Response.json({ error: "Fotoğraf içeriği geçersiz, çok büyük veya desteklenmeyen bir biçimde." }, { status: 415 });
    }

    let code = "";
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = makeCode();
      if (!(await roomExists(candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error("Benzersiz oda kodu üretilemedi.");
    }
    imageKey = await putPuzzleImage(code, imageBody, validatedImage.type);
    const room = await storeRoom({ code, title, rows, cols, pieces, image_key: imageKey, updated_at: Date.now() });
    roomSaved = true;
    return Response.json({ room: roomJson(room) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Puzzle odası oluşturulamadı:", error);
    if (imageKey && !roomSaved) {
      try { await deletePuzzleImage(imageKey); } catch { /* Keep the original upload error. */ }
    }
    return Response.json(
      { error: uploadErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  if (!allowRequest(request, "room-write", 240, 60_000)) return rateLimitedResponse();
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PATCH_REQUEST_BYTES) {
    return Response.json({ error: "Hamle isteği çok büyük." }, { status: 413 });
  }
  await ensureSchema();
  let payload: { code?: string; pieces?: Piece[]; piece?: Piece };
  try {
    payload = await request.json() as { code?: string; pieces?: Piece[]; piece?: Piece };
  } catch {
    return Response.json({ error: "Hamle verisi okunamadı." }, { status: 400 });
  }
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  if (!code || !isValidRoomCode(code) || (!Array.isArray(payload.pieces) && !payload.piece) || (payload.pieces && payload.piece)) {
    return Response.json({ error: "Geçersiz hamle." }, { status: 400 });
  }
  let room = await getRoom(code);
  if (!room) return Response.json({ error: "Oda bulunamadı." }, { status: 404 });
  if (Date.now() - roomActivityAt(room) >= ROOM_TTL_MS) {
    await deleteRoom(room.code, room.image_key);
    return Response.json({ error: "Bu odanın süresi dolmuş." }, { status: 404 });
  }
  const movedPiece = payload.piece ? normalizePuzzlePiece(payload.piece, room.rows, room.cols) : null;
  if (payload.piece && !movedPiece) return Response.json({ error: "Geçersiz parça." }, { status: 400 });
  const requestedPieces = payload.pieces ? normalizePuzzlePieces(payload.pieces, room.rows, room.cols) : null;
  if (payload.pieces && !requestedPieces) return Response.json({ error: "Parça verisi geçersiz veya eksik." }, { status: 400 });

  let committed = false;
  let updatedAt = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const latest = await getRoom(code);
      if (!latest) return Response.json({ error: "Oda bulunamadı." }, { status: 404 });
      room = latest;
    }
    const currentPieces = canonicalStoredPieces(room);
    if (movedPiece) {
      const currentPiece = currentPieces[movedPiece.id];
      if (currentPiece.locked) {
        const now = Date.now();
        await touchRoomActivity(code, now, now - ACTIVITY_TOUCH_INTERVAL_MS);
        return Response.json({ ok: true, updatedAt: room.updated_at }, { headers: { "Cache-Control": "no-store" } });
      }
      updatedAt = Math.max(Date.now(), room.updated_at + 1);
      const pieceUpdated = await updateRoomPiece(code, movedPiece, updatedAt, room.updated_at);
      if (pieceUpdated === null) {
        const fallbackPieces = currentPieces.map((piece) => piece.id === movedPiece.id ? movedPiece : piece);
        committed = await updateRoomPieces(code, fallbackPieces, updatedAt, room.updated_at);
      } else {
        committed = pieceUpdated;
      }
    } else {
      const lockedIds = new Set(currentPieces.filter((piece) => piece.locked).map((piece) => piece.id));
      const pieces = requestedPieces!.map((piece) => lockedIds.has(piece.id)
        ? currentPieces[piece.id]
        : piece);
      updatedAt = Math.max(Date.now(), room.updated_at + 1);
      committed = await updateRoomPieces(code, pieces, updatedAt, room.updated_at);
    }
    if (committed) break;
  }
  if (!committed) {
    return Response.json({ error: "Oda aynı anda güncellendi; hamleyi tekrar dene." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  after(async () => {
    try {
      await broadcastRoomChange(code, { updatedAt });
    } catch (error) {
      // REST state is authoritative; Realtime only wakes clients sooner.
      console.warn("Puzzle Realtime yayını gönderilemedi:", error);
    }
  });
  return Response.json({ ok: true, updatedAt }, { headers: { "Cache-Control": "no-store" } });
}
