create table if not exists public.puzzle_rooms (
  code text primary key,
  title text not null,
  rows integer not null check (rows between 2 and 32),
  cols integer not null check (cols between 2 and 32),
  pieces jsonb not null,
  image_key text not null,
  updated_at bigint not null
);

alter table public.puzzle_rooms enable row level security;
revoke all on table public.puzzle_rooms from anon, authenticated;
grant select, insert, update, delete on table public.puzzle_rooms to service_role;

insert into storage.buckets (id, name, public)
values ('puzzle-images', 'puzzle-images', true)
on conflict (id) do update set public = excluded.public;
