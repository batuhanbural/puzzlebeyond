create table if not exists public.puzzle_rooms (
  code text primary key check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  title text not null,
  rows integer not null check (rows between 2 and 48),
  cols integer not null check (cols between 2 and 48),
  pieces jsonb not null,
  image_key text not null,
  updated_at bigint not null
);

alter table public.puzzle_rooms enable row level security;
revoke all on table public.puzzle_rooms from anon, authenticated;
grant select, insert, update, delete on table public.puzzle_rooms to service_role;

do $$
begin
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_rows_check;
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_cols_check;
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_code_check;
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_piece_count_check;
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_payload_check;
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_title_check;
  alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_image_key_check;
  alter table public.puzzle_rooms add constraint puzzle_rooms_rows_check check (rows between 2 and 48);
  alter table public.puzzle_rooms add constraint puzzle_rooms_cols_check check (cols between 2 and 48);
  alter table public.puzzle_rooms add constraint puzzle_rooms_code_check
    check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$');
  alter table public.puzzle_rooms add constraint puzzle_rooms_piece_count_check check (rows * cols <= 1200);
  alter table public.puzzle_rooms add constraint puzzle_rooms_payload_check check (
    jsonb_typeof(pieces) = 'array' and jsonb_array_length(pieces) = rows * cols
  );
  alter table public.puzzle_rooms add constraint puzzle_rooms_title_check check (char_length(title) between 1 and 48);
  alter table public.puzzle_rooms add constraint puzzle_rooms_image_key_check check (char_length(image_key) between 1 and 512);
exception when undefined_table then
  null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'puzzle-images',
  'puzzle-images',
  false,
  4194304,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.gallery_puzzles (
  id text primary key,
  title text not null,
  description text not null default '',
  image_key text not null,
  image_kind text not null check (image_kind in ('custom', 'sunset', 'garden', 'city')),
  rows integer not null check (rows between 2 and 48),
  cols integer not null check (cols between 2 and 48),
  accent text not null default '#d8ff63',
  created_at bigint not null
);

alter table public.gallery_puzzles enable row level security;
revoke all on table public.gallery_puzzles from anon, authenticated;
grant select, insert, update, delete on table public.gallery_puzzles to service_role;

do $$
begin
  alter table public.gallery_puzzles drop constraint if exists gallery_puzzles_rows_check;
  alter table public.gallery_puzzles drop constraint if exists gallery_puzzles_cols_check;
  alter table public.gallery_puzzles add constraint gallery_puzzles_rows_check check (rows between 2 and 48);
  alter table public.gallery_puzzles add constraint gallery_puzzles_cols_check check (cols between 2 and 48);
exception when undefined_table then
  null;
end $$;

create table if not exists public.site_presence (
  client_id text primary key,
  room_code text check (room_code is null or room_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  nickname text not null default 'Misafir',
  last_seen_at bigint not null,
  revoked_at bigint
);

alter table public.site_presence drop constraint if exists site_presence_room_code_check;
alter table public.site_presence add constraint site_presence_room_code_check
  check (room_code is null or room_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$');
update public.site_presence as presence
set room_code = null
where room_code is not null
  and not exists (
    select 1 from public.puzzle_rooms as room where room.code = presence.room_code
  );
alter table public.site_presence drop constraint if exists site_presence_room_code_fkey;
alter table public.site_presence add constraint site_presence_room_code_fkey
  foreign key (room_code) references public.puzzle_rooms(code)
  on update cascade on delete set null;

alter table public.site_presence enable row level security;
revoke all on table public.site_presence from anon, authenticated;
grant select, insert, update, delete on table public.site_presence to service_role;

create index if not exists puzzle_rooms_updated_at_idx on public.puzzle_rooms (updated_at);
create index if not exists site_presence_active_idx on public.site_presence (last_seen_at, revoked_at);

insert into public.gallery_puzzles (id, title, description, image_key, image_kind, rows, cols, accent, created_at)
values
  ('sunset', 'Gün batımı', 'Sıcak renkler, uzun bir akşam.', 'builtin:sunset', 'sunset', 3, 4, '#ff6f61', 1700000000000),
  ('garden', 'Çiçek bahçesi', 'Renkli bir masa için kolay başlangıç.', 'builtin:garden', 'garden', 4, 5, '#d8ff63', 1700000001000),
  ('city', 'Gece şehri', 'Biraz daha sakin, biraz daha zor.', 'builtin:city', 'city', 6, 8, '#4864ff', 1700000002000)
on conflict (id) do nothing;
