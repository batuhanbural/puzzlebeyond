import { maybeCleanupExpiredRooms } from "@/lib/storage";

export const runtime = "nodejs";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Yetkisiz istek." }, { status: 401 });
  }

  try {
    await maybeCleanupExpiredRooms(Date.now() - ROOM_TTL_MS);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Oda temizliği başarısız:", error);
    return Response.json({ error: "Oda temizliği başarısız." }, { status: 500 });
  }
}
