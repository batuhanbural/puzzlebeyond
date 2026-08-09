-- Rekey every non-six-character room before enforcing the final strict constraint.
-- image_key is intentionally unchanged: object storage paths are opaque identifiers.
begin;

lock table public.puzzle_rooms in access exclusive mode;
lock table public.site_presence in access exclusive mode;

do $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  room_record record;
  candidate text;
  attempts integer;
begin
  for room_record in
    select code
    from public.puzzle_rooms
    where code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
    order by code
  loop
    attempts := 0;
    candidate := left(room_record.code, 6);

    if candidate !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
      or exists (select 1 from public.puzzle_rooms where code = candidate) then
      candidate := null;
    end if;

    if candidate is not null then
      attempts := 1;
    end if;

    while candidate is null loop
      select string_agg(
        substr(alphabet, 1 + floor(random() * char_length(alphabet))::integer, 1),
        '' order by position
      )
      into candidate
      from generate_series(1, 6) as positions(position);

      if exists (select 1 from public.puzzle_rooms where code = candidate) then
        candidate := null;
        attempts := attempts + 1;
        if attempts >= 1024 then
          raise exception 'Could not allocate a unique six-character room code';
        end if;
      end if;
    end loop;

    if to_regclass('public.site_presence') is not null then
      update public.site_presence
      set room_code = candidate
      where room_code = room_record.code;
    end if;

    update public.puzzle_rooms
    set code = candidate
    where code = room_record.code;
  end loop;
end $$;

update public.site_presence
set room_code = null
where room_code is not null
  and room_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$';

update public.site_presence as presence
set room_code = null
where room_code is not null
  and not exists (
    select 1 from public.puzzle_rooms as room where room.code = presence.room_code
  );

alter table public.puzzle_rooms drop constraint if exists puzzle_rooms_code_check;
alter table public.puzzle_rooms add constraint puzzle_rooms_code_check
  check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$');

alter table public.site_presence drop constraint if exists site_presence_room_code_check;
alter table public.site_presence add constraint site_presence_room_code_check
  check (room_code is null or room_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$');

alter table public.site_presence drop constraint if exists site_presence_room_code_fkey;
alter table public.site_presence add constraint site_presence_room_code_fkey
  foreign key (room_code) references public.puzzle_rooms(code)
  on update cascade on delete set null;

commit;
