import { createHash, timingSafeEqual } from "node:crypto";
import {
  adminPasswordConfigured,
  adminSessionSecretConfigured,
  clearSessionCookie,
  createAdminSession,
  isAdminRequest,
  sessionCookie,
} from "@/lib/admin-auth";

export const runtime = "nodejs";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_PASSWORD_BYTES = 512;
const MAX_TRACKED_CLIENTS = 5_000;

type LoginAttempt = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
};

const loginAttempts = new Map<string, LoginAttempt>();

function sameSecret(value: string, expected: string) {
  const left = createHash("sha256").update(value, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

function clientKey(request: Request) {
  const forwarded = (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for"))?.split(",", 1)[0].trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function pruneAttempts(now: number) {
  if (loginAttempts.size < 1_000) return;
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.lastSeenAt > LOGIN_WINDOW_MS + LOGIN_BLOCK_MS) loginAttempts.delete(key);
  }
  while (loginAttempts.size > MAX_TRACKED_CLIENTS) {
    const oldestKey = loginAttempts.keys().next().value as string | undefined;
    if (!oldestKey) break;
    loginAttempts.delete(oldestKey);
  }
}

function blockedSeconds(key: string, now: number) {
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.blockedUntil <= now) return 0;
  attempt.lastSeenAt = now;
  return Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1000));
}

function registerFailure(key: string, now: number) {
  const previous = loginAttempts.get(key);
  const attempt = !previous || now - previous.windowStartedAt >= LOGIN_WINDOW_MS
    ? { failures: 0, windowStartedAt: now, blockedUntil: 0, lastSeenAt: now }
    : previous;
  attempt.failures += 1;
  attempt.lastSeenAt = now;
  if (attempt.failures >= MAX_LOGIN_FAILURES) attempt.blockedUntil = now + LOGIN_BLOCK_MS;
  loginAttempts.set(key, attempt);
  pruneAttempts(now);
  return attempt.blockedUntil > now ? Math.ceil((attempt.blockedUntil - now) / 1000) : 0;
}

function rateLimited(retryAfter: number) {
  return Response.json({ error: "Çok fazla başarısız deneme. Bir süre sonra tekrar dene." }, {
    status: 429,
    headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
  });
}

export async function GET(request: Request) {
  return Response.json({
    authenticated: isAdminRequest(request),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const retryAfter = blockedSeconds(key, now);
  if (retryAfter) return rateLimited(retryAfter);
  const expected = process.env.ADMIN_PASSWORD?.trim() || "";
  if (!adminPasswordConfigured() || !adminSessionSecretConfigured()) {
    return Response.json({ error: "Admin servisi şu anda kullanılamıyor." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return Response.json({ error: "Geçersiz istek." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  let payload: { password?: unknown };
  try {
    payload = await request.json() as { password?: unknown };
  } catch {
    const blockedFor = registerFailure(key, now);
    if (blockedFor) return rateLimited(blockedFor);
    return Response.json({ error: "Geçersiz istek." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!password || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES || !sameSecret(password, expected)) {
    const blockedFor = registerFailure(key, now);
    if (blockedFor) return rateLimited(blockedFor);
    return Response.json({ error: "Parola hatalı." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  loginAttempts.delete(key);
  return Response.json({ ok: true }, {
    headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(createAdminSession()) },
  });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
