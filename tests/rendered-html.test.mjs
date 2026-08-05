import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("contains the puzzle app entry points", async () => {
  const [page, layout, packageJson] = await Promise.all([
    read("app/page.tsx"),
    read("app/layout.tsx"),
    read("package.json"),
  ]);

  assert.match(page, /export default function Home/);
  assert.match(page, /JigsawPiece/);
  assert.match(page, /GALERİYE GEÇ/);
  assert.match(layout, /generateMetadata|metadata/i);
  assert.match(packageJson, /\"build:vercel\"/);
});

test("exposes the production API routes", async () => {
  await Promise.all([
    access(new URL("app/api/room/route.ts", root)),
    access(new URL("app/api/gallery/route.ts", root)),
    access(new URL("app/api/cron/cleanup/route.ts", root)),
    access(new URL("supabase/schema.sql", root)),
  ]);

  const schema = await read("supabase/schema.sql");
  assert.match(schema, /create table if not exists public\.puzzle_rooms/i);
  assert.match(schema, /puzzle_rooms_updated_at_idx/);
});
