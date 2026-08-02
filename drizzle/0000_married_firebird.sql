CREATE TABLE `puzzle_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`rows` integer NOT NULL,
	`cols` integer NOT NULL,
	`pieces` text NOT NULL,
	`image_key` text NOT NULL,
	`updated_at` integer NOT NULL
);
