import { randomUUID } from "node:crypto";
import {
  createGalleryPuzzle,
  deleteGalleryImage,
  deleteGalleryPuzzle,
  getActiveUserCount,
  getGalleryPuzzles,
  putGalleryImage,
  type GalleryRecord,
} from "@/lib/storage";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function publicPuzzle(row: GalleryRecord) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.image_kind,
    imageUrl: row.image_kind === "custom" ? `/api/gallery-image?id=${encodeURIComponent(row.id)}` : "",
    rows: row.rows,
    cols: row.cols,
    count: row.rows * row.cols,
    accent: row.accent,
    createdAt: row.created_at,
  };
}

function unauthorized() {
  return Response.json({ error: "Yetkisiz erişim." }, { status: 401 });
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    const [puzzles, activeUsers] = await Promise.all([
      getGalleryPuzzles(),
      getActiveUserCount(Date.now() - 90_000),
    ]);
    return Response.json({ activeUsers, puzzles: puzzles.map(publicPuzzle) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Admin verileri okunamadı:", error);
    return Response.json({ error: "Admin tabloları bulunamadı. Supabase migration dosyasını çalıştır." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  let imageKey = "";
  try {
    const form = await request.formData();
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const rows = Number(form.get("rows"));
    const cols = Number(form.get("cols"));
    const accent = String(form.get("accent") || "#d8ff63").trim();
    const file = form.get("image");
    if (!title || title.length > 80) return Response.json({ error: "Başlık 1–80 karakter olmalı." }, { status: 400 });
    if (description.length > 200) return Response.json({ error: "Açıklama 200 karakteri geçemez." }, { status: 400 });
    if (!Number.isInteger(rows) || rows < 2 || rows > 32 || !Number.isInteger(cols) || cols < 2 || cols > 32) {
      return Response.json({ error: "Parça düzeni 2–32 satır ve sütun arasında olmalı." }, { status: 400 });
    }
    if (!/^#[0-9a-f]{6}$/i.test(accent)) return Response.json({ error: "Vurgu rengi geçersiz." }, { status: 400 });
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Bir görsel seçmelisin." }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "Görsel en fazla 4 MB olabilir." }, { status: 413 });
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Response.json({ error: "Yalnızca JPG, PNG veya WebP kullanılabilir." }, { status: 415 });

    const id = `custom-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    imageKey = await putGalleryImage(id, await file.arrayBuffer(), file.type);
    const puzzle = await createGalleryPuzzle({
      id,
      title,
      description,
      image_key: imageKey,
      image_kind: "custom",
      rows,
      cols,
      accent,
      created_at: Date.now(),
    });
    return Response.json({ puzzle: publicPuzzle(puzzle) }, { status: 201 });
  } catch (error) {
    if (imageKey) {
      try { await deleteGalleryImage(imageKey); } catch { /* Keep the original error for the client. */ }
    }
    console.error("Admin galerisine puzzle eklenemedi:", error);
    return Response.json({ error: "Puzzle eklenemedi. Supabase ayarlarını kontrol et." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "Puzzle kimliği gerekli." }, { status: 400 });
  try {
    const deleted = await deleteGalleryPuzzle(id);
    if (!deleted) return Response.json({ error: "Puzzle bulunamadı." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Admin galerisinden puzzle silinemedi:", error);
    return Response.json({ error: "Puzzle silinemedi." }, { status: 500 });
  }
}
