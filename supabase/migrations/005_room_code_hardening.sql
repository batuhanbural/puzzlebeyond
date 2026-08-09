-- Transitional constraint: both legacy six-character and temporary eight-character codes.
alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_code_check;
alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_piece_count_check;
alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_payload_check;
alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_title_check;
alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_image_key_check;
alter table public.puzzle_rooms add constraint puzzle_rooms_code_check check (
  code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
  or code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'
);
alter table public.puzzle_rooms add constraint puzzle_rooms_piece_count_check check (rows * cols <= 1200);
alter table public.puzzle_rooms add constraint puzzle_rooms_payload_check check (
  jsonb_typeof(pieces) = 'array' and jsonb_array_length(pieces) = rows * cols
);
alter table public.puzzle_rooms add constraint puzzle_rooms_title_check check (char_length(title) between 1 and 48);
alter table public.puzzle_rooms add constraint puzzle_rooms_image_key_check check (char_length(image_key) between 1 and 512);
