-- Stores the display name shown to other solvers in the shared room.
alter table public.site_presence
  add column if not exists nickname text not null default 'Misafir';
