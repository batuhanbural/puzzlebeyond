import { timingSafeEqual } from "node:crypto";
import {
  adminPasswordConfigured,
  clearSessionCookie,
  createAdminSession,
  isAdminRequest,
  sessionCookie,
} from "@/lib/admin-auth";

export const runtime = "nodejs";

function sameSecret(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  return Response.json({ authenticated: isAdminRequest(request), configured: adminPasswordConfigured() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const expected = process.env.ADMIN_PASSWORD?.trim() || "";
  if (!expected) return Response.json({ error: "Admin parolası Vercel ortam değişkenlerinde tanımlı değil." }, { status: 500 });
  let payload: { password?: string };
  try {
    payload = await request.json() as { password?: string };
  } catch {
    return Response.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  if (!payload.password || !sameSecret(payload.password, expected)) {
    return Response.json({ error: "Parola hatalı." }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(createAdminSession()) } });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
