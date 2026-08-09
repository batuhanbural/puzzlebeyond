PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_puzzle_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`rows` integer NOT NULL,
	`cols` integer NOT NULL,
	`pieces` text NOT NULL,
	`image_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	CONSTRAINT "puzzle_rooms_code_check" CHECK(length("__new_puzzle_rooms"."code") = 6 and "__new_puzzle_rooms"."code" not glob '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*')
);
--> statement-breakpoint
INSERT INTO `__new_puzzle_rooms`(
	"code", "title", "rows", "cols", "pieces", "image_key", "updated_at", "last_active_at"
)
SELECT
	CASE WHEN length(source."code") = 6 THEN source."code" ELSE substr(source."code", 1, 6) END,
	source."title",
	source."rows",
	source."cols",
	source."pieces",
	source."image_key",
	source."updated_at",
	source."updated_at"
FROM `puzzle_rooms` AS source
WHERE (
	length(source."code") = 6
	AND source."code" NOT GLOB '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*'
) OR (
	length(source."code") = 8
	AND source."code" NOT GLOB '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*'
	AND NOT EXISTS (
		SELECT 1 FROM `puzzle_rooms` AS existing
		WHERE existing."code" = substr(source."code", 1, 6)
	)
	AND source."code" = (
		SELECT min(candidate."code")
		FROM `puzzle_rooms` AS candidate
		WHERE length(candidate."code") = 8
			AND candidate."code" NOT GLOB '*[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]*'
			AND substr(candidate."code", 1, 6) = substr(source."code", 1, 6)
	)
);--> statement-breakpoint
DROP TABLE `puzzle_rooms`;--> statement-breakpoint
ALTER TABLE `__new_puzzle_rooms` RENAME TO `puzzle_rooms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
