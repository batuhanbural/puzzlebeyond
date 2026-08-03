import { DEFAULT_GALLERY } from "@/lib/gallery";
import { getGalleryPuzzles, type GalleryRecord } from "@/lib/storage";

export const runtime = "nodejs";

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
  };
}

export async function GET() {
  try {
    const puzzles = await getGalleryPuzzles();
    return Response.json({ puzzles: puzzles.map(publicPuzzle) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Galeri okunamadı:", error);
    return Response.json({
      puzzles: DEFAULT_GALLERY.map((puzzle) => ({ ...puzzle, imageUrl: "" })),
      setupRequired: true,
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
