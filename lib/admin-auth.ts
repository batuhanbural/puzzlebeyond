import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "parca_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 12;
const MIN_SESSION_SECRET_LENGTH = 32;

function password() {
  return process.env.ADMIN_PASSWORD?.trim() || "";
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET?.trim() || "";
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`v1.${payload}`).digest("hex");
}

function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function adminPasswordConfigured() {
  return password().length >= MIN_PASSWORD_LENGTH;
}

export function adminSessionSecretConfigured() {
  return sessionSecret().length >= MIN_SESSION_SECRET_LENGTH;
}

export function createAdminSession() {
  const secret = sessionSecret();
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error("ADMIN_SESSION_SECRET en az 32 karakter olmalı.");
  }
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${signature(expiresAt, secret)}`;
}

export function isAdminRequest(request: Request) {
  const secret = sessionSecret();
  if (secret.length < MIN_SESSION_SECRET_LENGTH) return false;
  const cookies = request.headers.get("cookie") || "";
  const token = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiresAt, providedSignature] = parts;
  if (!expiresAt || !providedSignature || !/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;
  return equal(providedSignature, signature(expiresAt, secret));
}

export function sessionCookie(value: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=0`;
}
