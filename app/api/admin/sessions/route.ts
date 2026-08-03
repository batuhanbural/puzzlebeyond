import { getActivePresences, getRoomSummaries, removePresence, revokePresence, type PresenceRecord, type RoomSummary } from "@/lib/storage";
import { isAdminRequest } from "@/lib/admin-auth";

export const runtime = "nodejs";

const ACTIVE_WINDOW_MS = 90_000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

function unauthorized() {
  return Response.json({ error: "Yetkisiz eri\u015fim." }, { status: 401 });
}

function sessionJson(row: PresenceRecord) {
  return {
    clientId: row.client_id,
    roomCode: row.room_code,
    lastSeenAt: row.last_seen_at,
    lastSeenLabel: new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(row.last_seen_at),
  };
}

function emptyRoomJson(row: RoomSummary, now: number) {
  const lastActivityAt = Number(row.updated_at);
  const expiresAt = lastActivityAt + ROOM_TTL_MS;
  const remainingMs = Math.max(0, expiresAt - now);
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const remainingLabel = days > 0
    ? `${days} gün ${hours} saat`
    : hours > 0
      ? `${hours} saat ${minutes} dk`
      : `${minutes} dk`;
  const timeLabel = (timestamp: number) => new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(timestamp);
  return {
    code: row.code,
    title: row.title,
    rows: row.rows,
    cols: row.cols,
    lastActivityAt,
    lastActivityLabel: timeLabel(lastActivityAt),
    expiresAt,
    expiresLabel: timeLabel(expiresAt),
    remainingMs,
    remainingLabel,
  };
}

function validClientId(value: unknown) {
  const clientId = typeof value === "string" ? value.trim() : "";
  return clientId.length >= 8 && clientId.length <= 128 ? clientId : null;
}

async function activeSessions() {
  return getActivePresences(Date.now() - ACTIVE_WINDOW_MS);
}

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    const now = Date.now();
    const [sessions, rooms] = await Promise.all([activeSessions(), getRoomSummaries()]);
    const activeRoomCodes = new Set(sessions.map((session) => session.room_code).filter((code): code is string => Boolean(code)));
    const emptyRooms = rooms
      .filter((room) => !activeRoomCodes.has(room.code) && Number(room.updated_at) + ROOM_TTL_MS > now)
      .map((room) => emptyRoomJson(room, now));
    return Response.json(
      { activeUsers: sessions.length, sessions: sessions.map(sessionJson), emptyRooms },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Admin oturumlar\u0131 okunamad\u0131:", error);
    return Response.json({ error: "Oturum tablosu okunamad\u0131. Yeni Supabase migration dosyas\u0131n\u0131 \u00e7al\u0131\u015ft\u0131r." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    const payload = await request.json() as { clientId?: unknown; all?: boolean };
    const sessions = payload.all ? await activeSessions() : [];
    const clientIds = payload.all
      ? sessions.map((session) => session.client_id)
      : [validClientId(payload.clientId)].filter((clientId): clientId is string => Boolean(clientId));
    if (!clientIds.length) return Response.json({ error: "Ge\u00e7erli bir oturum se\u00e7melisin." }, { status: 400 });
    await Promise.all(clientIds.map((clientId) => revokePresence(clientId, Date.now())));
    return Response.json({ ok: true, closed: clientIds.length });
  } catch (error) {
    console.error("Admin oturumu kapat\u0131lamad\u0131:", error);
    return Response.json({ error: "Oturum kapat\u0131lamad\u0131. Supabase session migration'\u0131n\u0131 kontrol et." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();
  try {
    const clientId = new URL(request.url).searchParams.get("clientId");
    if (clientId === "all") {
      const sessions = await activeSessions();
      await Promise.all(sessions.map((session) => removePresence(session.client_id)));
      return Response.json({ ok: true, deleted: sessions.length });
    }
    const validId = validClientId(clientId);
    if (!validId) return Response.json({ error: "Ge\u00e7erli bir oturum se\u00e7melisin." }, { status: 400 });
    await removePresence(validId);
    return Response.json({ ok: true, deleted: 1 });
  } catch (error) {
    console.error("Admin oturumu silinemedi:", error);
    return Response.json({ error: "Oturum silinemedi." }, { status: 500 });
  }
}
