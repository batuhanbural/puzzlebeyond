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
  rows integer not null check (rows between 2 and 32),
  cols integer not null check (cols between 2 and 32),
  accent text not null default '#d8ff63',
  created_at bigint not null
);

alter table public.gallery_puzzles enable row level security;
revoke all on table public.gallery_puzzles from anon, authenticated;
grant select, insert, update, delete on table public.gallery_puzzles to service_role;

create table if not exists public.site_presence (
  client_id text primary key,
  room_code text,
  nickname text not null default 'Misafir',
  last_seen_at bigint not null,
  revoked_at bigint
);

alter table public.site_presence add column if not exists revoked_at bigint;

alter table public.site_presence enable row level security;
revoke all on table public.site_presence from anon, authenticated;
grant select, insert, update, delete on table public.site_presence to service_role;

create index if not exists site_presence_last_seen_idx on public.site_presence (last_seen_at);
create index if not exists site_presence_active_idx on public.site_presence (last_seen_at, revoked_at);

insert into public.gallery_puzzles (id, title, description, image_key, image_kind, rows, cols, accent, created_at)
values
  ('sunset', 'Gün batımı', 'Sıcak renkler, uzun bir akşam.', 'builtin:sunset', 'sunset', 3, 4, '#ff6f61', 1700000000000),
  ('garden', 'Çiçek bahçesi', 'Renkli bir masa için kolay başlangıç.', 'builtin:garden', 'garden', 4, 5, '#d8ff63', 1700000001000),
  ('city', 'Gece şehri', 'Biraz daha sakin, biraz daha zor.', 'builtin:city', 'city', 6, 8, '#4864ff', 1700000002000)
on conflict (id) do nothing;
