-- Adds durable admin session closure without changing existing presence rows.
alter table public.site_presence add column if not exists revoked_at bigint;

create index if not exists site_presence_active_idx
  on public.site_presence (last_seen_at, revoked_at);
