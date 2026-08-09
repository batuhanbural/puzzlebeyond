import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const projectRoot = new URL("../", import.meta.url);

async function applyMigration(database, relativePath) {
  const migration = await readFile(new URL(relativePath, projectRoot), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

test("D1 migration rekeys existing rooms and rejects eight-character codes", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    await applyMigration(database, "drizzle/0000_married_firebird.sql");
    const insertLegacy = database.prepare(`
      insert into puzzle_rooms (code, title, rows, cols, pieces, image_key, updated_at)
      values (?, 'Test', 3, 4, '[]', ?, ?)
    `);
    insertLegacy.run("A2B3C4", "puzzles/A2B3C4/image", 100);
    insertLegacy.run("D5E6F7GH", "puzzles/D5E6F7GH/image", 200);

    await applyMigration(database, "drizzle/0001_panoramic_clea.sql");
    await applyMigration(database, "drizzle/0002_lucky_jackal.sql");

    const rooms = database.prepare("select code, updated_at, last_active_at from puzzle_rooms order by code").all()
      .map((room) => ({ ...room }));
    assert.deepEqual(rooms, [
      { code: "A2B3C4", updated_at: 100, last_active_at: 100 },
      { code: "D5E6F7", updated_at: 200, last_active_at: 200 },
    ]);
    assert.throws(
      () => database.prepare(`
        insert into puzzle_rooms (code, title, rows, cols, pieces, image_key, updated_at, last_active_at)
        values ('A2B3C4D5', 'Invalid', 3, 4, '[]', 'invalid', 300, 300)
      `).run(),
      /CHECK constraint failed/,
    );
    const indexes = database.prepare("pragma index_list('puzzle_rooms')").all();
    assert.ok(indexes.some((entry) => entry.name === "puzzle_rooms_last_active_at_idx"));
  } finally {
    database.close();
  }
});
