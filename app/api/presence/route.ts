import { removePresence, touchPresence } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { clientId?: string; roomCode?: string | null; leave?: boolean };
    const clientId = payload.clientId?.trim() || "";
    if (clientId.length < 8 || clientId.length > 128) return Response.json({ error: "Geçersiz istemci." }, { status: 400 });
    if (payload.leave) {
      await removePresence(clientId);
    } else {
      const roomCode = payload.roomCode?.trim().toUpperCase() || null;
      await touchPresence(clientId, roomCode && /^[A-Z0-9]{6}$/.test(roomCode) ? roomCode : null, Date.now());
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Presence güncellenemedi:", error);
    return Response.json({ error: "Presence güncellenemedi." }, { status: 500 });
  }
}
