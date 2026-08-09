import {
  ensureSchema,
  getRoomMetadata,
  getRoomPresences,
  removePresence,
  roomActivityAt,
  touchPresence,
  touchRoomActivity,
} from "@/lib/storage";
import {
  clearPresenceCookie,
  createPresenceIdentity,
  presenceAuthConfigured,
  presenceCookie,
  publicPresenceId,
  readPresenceId,
} from "@/lib/presence-auth";
import { isValidRoomCode } from "@/lib/puzzle-validation";
import { allowRequest, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ACTIVE_WINDOW_MS = 90_000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_ACTIVITY_TOUCH_INTERVAL_MS = 60 * 1000;

function normalizeNickname(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 24)
    : "";
}

export async function GET(request: Request) {
  if (!allowRequest(request, "presence-read", 120, 60_000)) return rateLimitedResponse();
  try {
    if (!presenceAuthConfigured()) {
      return Response.json({ error: "Presence imza anahtarı yapılandırılmamış." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const roomCode = new URL(request.url).searchParams.get("roomCode")?.trim().toUpperCase() || "";
    if (!isValidRoomCode(roomCode)) return Response.json({ error: "Geçerli bir oda kodu gerekli." }, { status: 400 });
    const ownId = readPresenceId(request);
    const rows = await getRoomPresences(roomCode, Date.now() - ACTIVE_WINDOW_MS);
    const players = rows.map((row) => ({
      clientId: row.client_id === ownId ? "self" : publicPresenceId(row.client_id, roomCode),
      nickname: row.nickname?.trim() || "Misafir",
      lastSeenAt: row.last_seen_at,
    }));
    return Response.json({ players }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Oda oyuncuları okunamadı:", error);
    return Response.json({ error: "Odadaki oyuncular okunamadı." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!allowRequest(request, "presence-write", 120, 60_000)) return rateLimitedResponse();
  try {
    if (!presenceAuthConfigured()) {
      return Response.json({ error: "Presence imza anahtarı yapılandırılmamış." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 4_096) {
      return Response.json({ error: "Presence isteği çok büyük." }, { status: 413 });
    }
    let payload: { roomCode?: string | null; nickname?: string; leave?: boolean };
    try {
      payload = await request.json() as { roomCode?: string | null; nickname?: string; leave?: boolean };
    } catch {
      return Response.json({ error: "Geçersiz presence isteği." }, { status: 400 });
    }

    const existingId = readPresenceId(request);
    const identity = existingId ? null : createPresenceIdentity();
    const clientId = existingId || identity!.id;
    if (payload.leave === true) {
      await removePresence(clientId);
      return new Response(null, { status: 204, headers: { "Set-Cookie": clearPresenceCookie(), "Cache-Control": "no-store" } });
    }

    const roomCode = typeof payload.roomCode === "string" ? payload.roomCode.trim().toUpperCase() || null : null;
    const now = Date.now();
    if (roomCode && !isValidRoomCode(roomCode)) {
      return Response.json({ error: "Oda bulunamadı." }, { status: 404 });
    }
    if (roomCode) {
      await ensureSchema();
      const room = await getRoomMetadata(roomCode);
      if (!room || now - roomActivityAt(room) >= ROOM_TTL_MS) {
        return Response.json({ error: "Oda bulunamadı." }, { status: 404 });
      }
      const staleBefore = now - ROOM_ACTIVITY_TOUCH_INTERVAL_MS;
      if (roomActivityAt(room) < staleBefore) await touchRoomActivity(roomCode, now, staleBefore);
    }
    const nickname = normalizeNickname(payload.nickname) || "Misafir";
    const active = await touchPresence(clientId, roomCode, now, nickname);
    if (!active) return Response.json({ error: "Bu oturum admin tarafından kapatıldı.", revoked: true }, { status: 410 });

    const headers = new Headers({ "Cache-Control": "no-store" });
    if (identity) headers.set("Set-Cookie", presenceCookie(identity.token));
    return new Response(null, { status: 204, headers });
  } catch (error) {
    console.error("Presence güncellenemedi:", error);
    return Response.json({ error: "Presence güncellenemedi." }, { status: 500 });
  }
}
