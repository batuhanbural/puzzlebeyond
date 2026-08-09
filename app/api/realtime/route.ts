import { allowRequest, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const CONFIG_CACHE_CONTROL = "private, max-age=300, stale-while-revalidate=600";

export async function GET(request: Request) {
  if (!allowRequest(request, "realtime-config", 120, 60_000)) return rateLimitedResponse();
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || "";
  if (!url || !key) {
    return Response.json({ enabled: false }, { headers: { "Cache-Control": CONFIG_CACHE_CONTROL } });
  }
  return Response.json({ enabled: true, url, key }, { headers: { "Cache-Control": CONFIG_CACHE_CONTROL } });
}
