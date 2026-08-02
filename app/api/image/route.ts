import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });
  const row = await env.DB.prepare("SELECT image_key FROM puzzle_rooms WHERE code = ?").bind(code).first<{ image_key: string }>();
  if (!row) return new Response("Not found", { status: 404 });
  const object = await env.BUCKET.get(row.image_key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}
