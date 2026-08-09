import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "puzzlebeyond_presence";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  return process.env.PRESENCE_SECRET?.trim()
    || process.env.ADMIN_SESSION_SECRET?.trim()
    || process.env.SUPABASE_SECRET_KEY?.trim()
    || "";
}

function sign(value: string) {
  const key = secret();
  return key.length >= 24 ? createHmac("sha256", key).update(value).digest("base64url") : "";
}

function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(request: Request) {
  const cookies = request.headers.get("cookie") || "";
  return cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) || "";
}

export function presenceAuthConfigured() {
  return secret().length >= 24;
}

export function readPresenceId(request: Request) {
  const parts = cookieValue(request).split(".");
  if (parts.length !== 2) return null;
  const [id, providedSignature] = parts;
  if (!id || !providedSignature || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = sign(id);
  return expected && equal(providedSignature, expected) ? id : null;
}

export function createPresenceIdentity() {
  const id = randomUUID();
  return { id, token: `${id}.${sign(id)}` };
}

export function presenceCookie(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SECONDS}`;
}

export function clearPresenceCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}

export function publicPresenceId(id: string, roomCode: string) {
  return sign(`${roomCode}:${id}`).slice(0, 18);
}
