import { env } from "cloudflare:workers";

type Piece = { id: number; x: number; y: number; locked?: boolean };
type RoomRow = { code: string; title: string; rows: number; cols: number; pieces: string; image_key: string; updated_at: number };

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  return Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
}

async function ensureSchema() {
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

function roomJson(row: RoomRow) {
  return {
    code: row.code,
    title: row.title,
    rows: row.rows,
    cols: row.cols,
    pieces: JSON.parse(row.pieces) as Piece[],
    imageUrl: `/api/image?code=${row.code}&v=${row.updated_at}`,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
  if (!code) return Response.json({ error: "Oda kodu gerekli." }, { status: 400 });
  const row = await env.DB.prepare("SELECT * FROM puzzle_rooms WHERE code = ?").bind(code).first<RoomRow>();
  if (!row) return Response.json({ error: "Bu kodla bir oda bulunamadı." }, { status: 404 });
  return Response.json({ room: roomJson(row) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  await ensureSchema();
  const form = await request.formData();
  const title = String(form.get("title") || "Bizim puzzle").slice(0, 48);
  const rows = Math.max(2, Math.min(6, Number(form.get("rows")) || 3));
  const cols = Math.max(2, Math.min(6, Number(form.get("cols")) || 4));
  const pieces = String(form.get("pieces") || "[]");
  const file = form.get("image");
  const defaultImage = String(form.get("defaultImage") || "");
  let imageBody: ArrayBuffer;
  let contentType = "image/jpeg";
  if (file instanceof File && file.size > 0) {
    if (file.size > 8 * 1024 * 1024) return Response.json({ error: "Fotoğraf en fazla 8 MB olabilir." }, { status: 413 });
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Response.json({ error: "Desteklenmeyen fotoğraf türü." }, { status: 415 });
    imageBody = await file.arrayBuffer(); contentType = file.type;
  } else if (defaultImage.startsWith("data:image/")) {
    const [meta, payload] = defaultImage.split(",");
    contentType = meta.match(/data:(.*?);/)?.[1] || "image/jpeg";
    imageBody = Uint8Array.from(atob(payload), c => c.charCodeAt(0)).buffer;
  } else {
    return Response.json({ error: "Bir fotoğraf seçmelisin." }, { status: 400 });
  }
  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const exists = await env.DB.prepare("SELECT code FROM puzzle_rooms WHERE code = ?").bind(code).first();
    if (!exists) break;
    code = makeCode();
  }
  const imageKey = `puzzles/${code}/original`;
  await env.BUCKET.put(imageKey, imageBody, { httpMetadata: { contentType } });
  const now = Date.now();
  await env.DB.prepare("INSERT INTO puzzle_rooms (code, title, rows, cols, pieces, image_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(code, title, rows, cols, pieces, imageKey, now).run();
  const row = await env.DB.prepare("SELECT * FROM puzzle_rooms WHERE code = ?").bind(code).first<RoomRow>();
  return Response.json({ room: roomJson(row!) }, { status: 201 });
}

export async function PATCH(request: Request) {
  await ensureSchema();
  const payload = await request.json() as { code?: string; pieces?: Piece[] };
  const code = payload.code?.trim().toUpperCase();
  if (!code || !Array.isArray(payload.pieces)) return Response.json({ error: "Geçersiz hamle." }, { status: 400 });
  const row = await env.DB.prepare("SELECT rows, cols FROM puzzle_rooms WHERE code = ?").bind(code).first<{ rows: number; cols: number }>();
  if (!row) return Response.json({ error: "Oda bulunamadı." }, { status: 404 });
  if (payload.pieces.length !== row.rows * row.cols) return Response.json({ error: "Parça sayısı eşleşmiyor." }, { status: 400 });
  const pieces = payload.pieces.map((piece) => ({
    id: Math.max(0, Math.floor(piece.id)), x: Math.max(0, Math.min(row.cols - 1, Math.floor(piece.x))),
    y: Math.max(0, Math.min(row.rows - 1, Math.floor(piece.y))), locked: Boolean(piece.locked),
  }));
  const now = Date.now();
  await env.DB.prepare("UPDATE puzzle_rooms SET pieces = ?, updated_at = ? WHERE code = ?").bind(JSON.stringify(pieces), now, code).run();
  return Response.json({ ok: true, updatedAt: now });
}
