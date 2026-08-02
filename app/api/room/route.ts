import {
  createRoom as storeRoom,
  ensureSchema,
  getRoom,
  putPuzzleImage,
  roomExists,
  updateRoomPieces,
  type Piece,
  type RoomRecord,
} from "@/lib/storage";

export const runtime = "nodejs";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

function roomJson(row: RoomRecord) {
  return {
    code: row.code,
    title: row.title,
    rows: row.rows,
    cols: row.cols,
    pieces: row.pieces,
    imageUrl: `/api/image?code=${row.code}&v=${row.updated_at}`,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  const since = Number(url.searchParams.get("since") || 0);
  if (!code) return Response.json({ error: "Oda kodu gerekli." }, { status: 400 });
  const room = await getRoom(code);
  if (!room) return Response.json({ error: "Bu kodla bir oda bulunamadı." }, { status: 404 });
  if (since > 0 && room.updated_at <= since) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return Response.json({ room: roomJson(room) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await ensureSchema();
  const form = await request.formData();
  const title = String(form.get("title") || "Bizim puzzle").slice(0, 48);
  const rows = Math.max(2, Math.min(32, Number(form.get("rows")) || 3));
  const cols = Math.max(2, Math.min(32, Number(form.get("cols")) || 4));
  const pieces = JSON.parse(String(form.get("pieces") || "[]")) as Piece[];
  if (pieces.length !== rows * cols) return Response.json({ error: "Parça sayısı eşleşmiyor." }, { status: 400 });
  const file = form.get("image");
  const defaultImage = String(form.get("defaultImage") || "");
  let imageBody: ArrayBuffer;
  let contentType = "image/jpeg";
  if (file instanceof File && file.size > 0) {
    if (file.size > 4 * 1024 * 1024) return Response.json({ error: "Fotoğraf en fazla 4 MB olabilir." }, { status: 413 });
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Response.json({ error: "Desteklenmeyen fotoğraf türü." }, { status: 415 });
    imageBody = await file.arrayBuffer();
    contentType = file.type;
  } else if (defaultImage.startsWith("data:image/")) {
    const [meta, payload] = defaultImage.split(",");
    contentType = meta.match(/data:(.*?);/)?.[1] || "image/jpeg";
    imageBody = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)).buffer;
  } else {
    return Response.json({ error: "Bir fotoğraf seçmelisin." }, { status: 400 });
  }

  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await roomExists(code))) break;
    code = makeCode();
  }
  const imageKey = await putPuzzleImage(code, imageBody, contentType);
  const room = await storeRoom({ code, title, rows, cols, pieces, image_key: imageKey, updated_at: Date.now() });
  return Response.json({ room: roomJson(room) }, { status: 201 });
}

export async function PATCH(request: Request) {
  await ensureSchema();
  const payload = await request.json() as { code?: string; pieces?: Piece[]; piece?: Piece };
  const code = payload.code?.trim().toUpperCase();
  if (!code || (!Array.isArray(payload.pieces) && !payload.piece)) return Response.json({ error: "Geçersiz hamle." }, { status: 400 });
  const room = await getRoom(code);
  if (!room) return Response.json({ error: "Oda bulunamadı." }, { status: 404 });
  if (payload.pieces && payload.pieces.length !== room.rows * room.cols) return Response.json({ error: "Parça sayısı eşleşmiyor." }, { status: 400 });
  const normalizePiece = (piece: Piece) => ({
    id: Math.max(0, Math.floor(piece.id)),
    x: Math.max(0, Math.min(1, Number(piece.x))),
    y: Math.max(0, Math.min(1, Number(piece.y))),
    locked: Boolean(piece.locked),
  });
  let pieces: Piece[];
  if (payload.piece) {
    const movedPiece = normalizePiece(payload.piece);
    if (movedPiece.id >= room.rows * room.cols) return Response.json({ error: "Geçersiz parça." }, { status: 400 });
    pieces = room.pieces.map((piece) => piece.id === movedPiece.id ? movedPiece : piece);
  } else {
    pieces = payload.pieces!.map(normalizePiece);
  }
  const now = Date.now();
  await updateRoomPieces(code, pieces, now);
  return Response.json({ ok: true, updatedAt: now });
}
