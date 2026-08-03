import { getGalleryImageResponse, getGalleryPuzzle } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "Puzzle görseli bulunamadı." }, { status: 400 });
  try {
    const puzzle = await getGalleryPuzzle(id);
    if (!puzzle || puzzle.image_kind !== "custom") return Response.json({ error: "Puzzle görseli bulunamadı." }, { status: 404 });
    return getGalleryImageResponse(puzzle.image_key);
  } catch (error) {
    console.error("Galeri görseli okunamadı:", error);
    return Response.json({ error: "Puzzle görseli okunamadı." }, { status: 404 });
  }
}
