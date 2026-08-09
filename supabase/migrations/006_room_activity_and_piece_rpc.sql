-- Keep room lifetime activity separate from the puzzle-state CAS version.
alter table public.puzzle_rooms add column if not exists last_active_at bigint;

update public.puzzle_rooms
set last_active_at = updated_at
where last_active_at is null;

alter table public.puzzle_rooms
  alter column last_active_at set default ((extract(epoch from clock_timestamp()) * 1000)::bigint),
  alter column last_active_at set not null;

create index if not exists puzzle_rooms_last_active_at_idx
  on public.puzzle_rooms (last_active_at);

create index if not exists site_presence_room_active_idx
  on public.site_presence (room_code, last_seen_at desc)
  where revoked_at is null;

create index if not exists site_presence_recent_active_idx
  on public.site_presence (last_seen_at desc)
  where revoked_at is null;

-- Atomically replace one canonical array element without sending the complete
-- pieces JSON back through Vercel. Only the server's service role may execute it.
create or replace function public.update_room_piece(
  target_code text,
  next_piece jsonb,
  next_updated_at bigint,
  expected_updated_at bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  piece_id integer;
  changed_rows integer;
begin
  if jsonb_typeof(next_piece) is distinct from 'object'
    or coalesce(next_piece ->> 'id', '') !~ '^[0-9]+$'
    or length(coalesce(next_piece ->> 'id', '')) > 6
    or jsonb_typeof(next_piece -> 'x') is distinct from 'number'
    or jsonb_typeof(next_piece -> 'y') is distinct from 'number'
    or jsonb_typeof(next_piece -> 'locked') is distinct from 'boolean'
    or jsonb_typeof(next_piece -> 'layoutVersion') is distinct from 'number'
    or coalesce(next_piece ->> 'zone', '') not in ('board', 'mat')
    or next_updated_at <= expected_updated_at
  then
    return false;
  end if;

  piece_id := (next_piece ->> 'id')::integer;

  update public.puzzle_rooms as room
  set pieces = jsonb_set(room.pieces, array[piece_id::text], next_piece, false),
      updated_at = next_updated_at,
      last_active_at = greatest(room.last_active_at, next_updated_at)
  where room.code = target_code
    and room.updated_at = expected_updated_at
    and jsonb_typeof(room.pieces) = 'array'
    and piece_id >= 0
    and jsonb_array_length(room.pieces) > piece_id
    and room.pieces -> piece_id ->> 'id' = piece_id::text
    and coalesce(room.pieces -> piece_id -> 'locked', 'false'::jsonb) <> 'true'::jsonb;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$function$;

revoke all on function public.update_room_piece(text, jsonb, bigint, bigint) from public;
revoke all on function public.update_room_piece(text, jsonb, bigint, bigint) from anon, authenticated;
grant execute on function public.update_room_piece(text, jsonb, bigint, bigint) to service_role;
