import { getGalleryImageResponse, getGalleryPuzzle } from "@/lib/storage";
import { allowRequest, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!allowRequest(request, "gallery-image", 600, 60_000)) return rateLimitedResponse();
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id || id.length > 96 || !/^[a-z0-9._-]+$/i.test(id)) return Response.json({ error: "Puzzle görseli bulunamadı." }, { status: 400 });
  try {
    const puzzle = await getGalleryPuzzle(id);
    if (!puzzle || puzzle.image_kind !== "custom") return Response.json({ error: "Puzzle görseli bulunamadı." }, { status: 404 });
    return getGalleryImageResponse(puzzle.image_key);
  } catch (error) {
    console.error("Galeri görseli okunamadı:", error);
    return Response.json({ error: "Puzzle görseli okunamadı." }, { status: 404 });
  }
}
