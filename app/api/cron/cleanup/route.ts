import { createHash, timingSafeEqual } from "node:crypto";
import { deleteStalePresences, maybeCleanupExpiredRooms } from "@/lib/storage";

export const runtime = "nodejs";

const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const PRESENCE_TTL_MS = 24 * 60 * 60 * 1000;

function sameAuthorization(value: string, expected: string) {
  const left = createHash("sha256").update(value, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || "";
  const authorization = request.headers.get("authorization") || "";
  if (secret.length < 16 || !sameAuthorization(authorization, `Bearer ${secret}`)) {
    return Response.json({ error: "Yetkisiz istek." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const now = Date.now();
    await Promise.all([
      maybeCleanupExpiredRooms(now - ROOM_TTL_MS),
      deleteStalePresences(now - PRESENCE_TTL_MS),
    ]);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Oda temizliği başarısız:", error);
    return Response.json({ error: "Oda temizliği başarısız." }, { status: 500 });
  }
}
