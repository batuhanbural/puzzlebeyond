import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const puzzleRooms = sqliteTable("puzzle_rooms", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  rows: integer("rows").notNull(),
  cols: integer("cols").notNull(),
  pieces: text("pieces").notNull(),
  imageKey: text("image_key").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastActiveAt: integer("last_active_at").notNull(),
}, (table) => [
  index("puzzle_rooms_last_active_at_idx").on(table.lastActiveAt),
  check(
    "puzzle_rooms_code_check",
    sql`length(${table.code}) = 6 and ${table.code} not glob '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*'`,
  ),
]);
