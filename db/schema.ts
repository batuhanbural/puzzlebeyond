import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const puzzleRooms = sqliteTable("puzzle_rooms", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  rows: integer("rows").notNull(),
  cols: integer("cols").notNull(),
  pieces: text("pieces").notNull(),
  imageKey: text("image_key").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
