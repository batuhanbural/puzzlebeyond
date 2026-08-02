import { getPuzzleImageResponse, getRoom } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });
  const room = await getRoom(code);
  if (!room) return new Response("Not found", { status: 404 });
  return await getPuzzleImageResponse(room.image_key) ?? new Response("Not found", { status: 404 });
}
