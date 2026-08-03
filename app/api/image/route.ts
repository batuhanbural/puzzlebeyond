import { deleteRoom, ensureSchema, getPuzzleImageDownloadResponse, getPuzzleImageResponse, getRoom } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });
  const room = await getRoom(code);
  if (!room) return new Response("Not found", { status: 404 });
  if (Date.now() - room.updated_at >= 24 * 60 * 60 * 1000) {
    await deleteRoom(room.code, room.image_key);
    return new Response("Expired", { status: 404 });
  }
  if (url.searchParams.get("download") === "1") {
    return await getPuzzleImageDownloadResponse(room.image_key, `puzzlebeyond-${room.code}.jpg`);
  }
  return await getPuzzleImageResponse(room.image_key) ?? new Response("Not found", { status: 404 });
}
