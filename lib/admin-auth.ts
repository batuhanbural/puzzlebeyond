import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "parca_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function password() {
  return process.env.ADMIN_PASSWORD?.trim() || "";
}

function signature(payload: string) {
  return createHmac("sha256", password()).update(payload).digest("hex");
}

function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function adminPasswordConfigured() {
  return Boolean(password());
}

export function createAdminSession() {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${signature(expiresAt)}`;
}

export function isAdminRequest(request: Request) {
  const secret = password();
  if (!secret) return false;
  const cookies = request.headers.get("cookie") || "";
  const token = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token) return false;
  const [expiresAt, providedSignature] = token.split(".");
  if (!expiresAt || !providedSignature || !/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;
  return equal(providedSignature, signature(expiresAt));
}

export function sessionCookie(value: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}
