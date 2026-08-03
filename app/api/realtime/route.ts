export const runtime = "nodejs";

export async function GET() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || "";
  if (!url || !key) {
    return Response.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ enabled: true, url, key }, { headers: { "Cache-Control": "no-store" } });
}
