type Entry = { count: number; resetAt: number };

const entries = new Map<string, Entry>();
const MAX_TRACKED_KEYS = 10_000;

function requesterAddress(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
  return forwarded.split(",", 1)[0].trim().slice(0, 96) || "unknown";
}

export function allowRequest(request: Request, bucket: string, limit: number, windowMs: number) {
  const now = Date.now();
  const key = `${bucket}:${requesterAddress(request)}`;
  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    if (entries.size >= MAX_TRACKED_KEYS) {
      for (const [candidate, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(candidate);
        if (entries.size < MAX_TRACKED_KEYS) break;
      }
      if (entries.size >= MAX_TRACKED_KEYS) entries.delete(entries.keys().next().value as string);
    }
    entries.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function rateLimitedResponse() {
  return Response.json({ error: "Çok fazla istek gönderdin. Lütfen kısa bir süre sonra tekrar dene." }, {
    status: 429,
    headers: { "Cache-Control": "no-store", "Retry-After": "60" },
  });
}
