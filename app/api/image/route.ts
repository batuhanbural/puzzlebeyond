import {
  deleteRoom,
  ensureSchema,
  getPuzzleImageDownloadResponse,
  getPuzzleImageResponse,
  getRoomMetadata,
  roomActivityAt,
} from "@/lib/storage";
import { isValidRoomCode } from "@/lib/puzzle-validation";
import { allowRequest, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!allowRequest(request, "room-image", 240, 60_000)) return rateLimitedResponse();
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  if (!code || !isValidRoomCode(code)) return new Response("Missing or invalid code", { status: 400 });
  await ensureSchema();
  const room = await getRoomMetadata(code);
  if (!room) return new Response("Not found", { status: 404 });
  if (Date.now() - roomActivityAt(room) >= 24 * 60 * 60 * 1000) {
    await deleteRoom(room.code, room.image_key);
    return new Response("Expired", { status: 404 });
  }
  if (url.searchParams.get("download") === "1") {
    return await getPuzzleImageDownloadResponse(room.image_key, `puzzlebeyond-${room.code}.jpg`);
  }
  return await getPuzzleImageResponse(room.image_key, {
    ifNoneMatch: request.headers.get("if-none-match"),
    ifModifiedSince: request.headers.get("if-modified-since"),
  }) ?? new Response("Not found", { status: 404 });
}
