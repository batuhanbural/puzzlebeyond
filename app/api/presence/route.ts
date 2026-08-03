import { getActivePresences, removePresence, touchPresence } from "@/lib/storage";

export const runtime = "nodejs";

const ACTIVE_WINDOW_MS = 90_000;

function normalizeNickname(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 24)
    : "";
}

export async function GET(request: Request) {
  try {
    const roomCode = new URL(request.url).searchParams.get("roomCode")?.trim().toUpperCase() || "";
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return Response.json({ error: "Geçerli bir oda kodu gerekli." }, { status: 400 });
    const rows = await getActivePresences(Date.now() - ACTIVE_WINDOW_MS);
    const players = rows
      .filter((row) => row.room_code === roomCode)
      .map((row) => ({ clientId: row.client_id, nickname: row.nickname?.trim() || "Misafir", lastSeenAt: row.last_seen_at }));
    return Response.json({ players }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Oda oyuncuları okunamadı:", error);
    return Response.json({ error: "Odadaki oyuncular okunamadı." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { clientId?: string; roomCode?: string | null; nickname?: string; leave?: boolean };
    const clientId = payload.clientId?.trim() || "";
    if (clientId.length < 8 || clientId.length > 128) return Response.json({ error: "Geçersiz istemci." }, { status: 400 });
    if (payload.leave) {
      await removePresence(clientId);
    } else {
      const roomCode = payload.roomCode?.trim().toUpperCase() || null;
      const nickname = normalizeNickname(payload.nickname) || "Misafir";
      const active = await touchPresence(clientId, roomCode && /^[A-Z0-9]{6}$/.test(roomCode) ? roomCode : null, Date.now(), nickname);
      if (!active) return Response.json({ error: "Bu oturum admin taraf\u0131ndan kapat\u0131ld\u0131.", revoked: true }, { status: 410 });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Presence güncellenemedi:", error);
    return Response.json({ error: "Presence güncellenemedi." }, { status: 500 });
  }
}
