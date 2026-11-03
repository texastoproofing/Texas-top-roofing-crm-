-- =====================================================================
-- Street Intelligence: estado por casa, historial, recorridos (canvassing)
-- Se apoya en street_houses (casas del registro del condado). No borra datos.
-- Todas las escrituras de vendedores pasan por funciones con validación de rol.
-- REVERTIR: ver bloque al final.
-- =====================================================================

-- 1) Estado y enlaces por casa
alter table public.street_houses
  add column if not exists status text not null default 'not_visited',
  add column if not exists status_updated_at timestamptz,
  add column if not exists status_updated_by uuid references public.profiles(id),
  add column if not exists assigned_to uuid references public.profiles(id),
  add column if not exists job_id uuid references public.jobs(id) on delete set null,
  add column if not exists last_note text;
do $$ begin
  alter table public.street_houses add constraint street_houses_status_chk
    check (status in ('not_visited','visited','no_answer','interested','appointment','customer','do_not_contact'));
exception when duplicate_object then null; end $$;
create index if not exists street_houses_status_idx on public.street_houses(street_id, status);
create index if not exists street_houses_job_idx on public.street_houses(job_id);

-- 2) Historial de cada casa (quién, cuándo, qué)
create table if not exists public.house_events (
  id uuid primary key default gen_random_uuid(),
  house_id uuid not null references public.street_houses(id) on delete cascade,
  street_id uuid not null references public.territory_streets(id) on delete cascade,
  kind text not null check (kind in ('status','visit','note','assign','skip','lead','appointment')),
  status text,
  note text,
  actor uuid not null references public.profiles(id),
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists house_events_house_idx on public.house_events(house_id, created_at desc);
create index if not exists house_events_street_idx on public.house_events(street_id, created_at desc);

-- 3) Sesiones de recorrido
create table if not exists public.canvass_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  street_id uuid not null references public.territory_streets(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_house_id uuid references public.street_houses(id) on delete set null,
  visited int not null default 0,
  skipped int not null default 0,
  leads int not null default 0,
  appointments int not null default 0,
  summary text
);
create index if not exists canvass_sessions_street_idx on public.canvass_sessions(street_id, ended_at);
create index if not exists canvass_sessions_user_idx on public.canvass_sessions(user_id, started_at desc);

-- RLS: el equipo activo puede leer (para no repetir puertas); escrituras por funciones
alter table public.house_events enable row level security;
alter table public.canvass_sessions enable row level security;
drop policy if exists house_events_read on public.house_events;
create policy house_events_read on public.house_events for select using (public.is_active());
drop policy if exists canvass_read on public.canvass_sessions;
create policy canvass_read on public.canvass_sessions for select using (public.is_active());
drop policy if exists canvass_own_insert on public.canvass_sessions;
create policy canvass_own_insert on public.canvass_sessions for insert with check (public.is_active() and user_id = auth.uid());
drop policy if exists canvass_own_update on public.canvass_sessions;
create policy canvass_own_update on public.canvass_sessions for update using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

-- 4) Cambiar estado de una casa (todos los usuarios activos)
--    "No contactar" solo lo puede quitar staff (admin, PM, asistente).
create or replace function public.set_house_status(p_house uuid, p_status text, p_note text default null, p_kind text default 'status', p_session uuid default null, p_expected timestamptz default null)
returns public.street_houses
language plpgsql security definer set search_path = public as $$
declare h public.street_houses; me uuid := auth.uid(); n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_active() then raise exception 'Usuario no activo'; end if;
  if p_status not in ('not_visited','visited','no_answer','interested','appointment','customer','do_not_contact') then raise exception 'Estado no válido'; end if;
  if p_kind not in ('status','visit','skip') then raise exception 'Tipo no válido'; end if;
  select * into h from public.street_houses where id = p_house for update;
  if not found then raise exception 'Casa no encontrada'; end if;
  -- Evita pisar el cambio de otro vendedor hecho mientras tanto
  if p_expected is not null and h.status_updated_at is distinct from p_expected then
    raise exception 'CONFLICTO: otra persona actualizó esta casa';
  end if;
  if h.status = 'do_not_contact' and p_status <> 'do_not_contact' and not public.is_staff() then
    raise exception 'Solo la oficina puede quitar "No contactar"';
  end if;
  if length(coalesce(n, '')) > 500 then n := left(n, 500); end if;
  update public.street_houses set status = p_status, status_updated_at = now(), status_updated_by = me,
    last_note = coalesce(n, last_note), updated_at = now()
  where id = p_house returning * into h;
  insert into public.house_events(house_id, street_id, kind, status, note, actor, session_id)
  values (p_house, h.street_id, p_kind, p_status, n, me, p_session);
  -- Una visita cuenta como puerta tocada y deja la calle en progreso
  if p_kind = 'visit' then
    update public.territory_streets set doors_knocked = coalesce(doors_knocked, 0) + 1, last_visit_at = now(), last_visit_by = me,
      status = case when status = 'pendiente' then 'en_progreso' else status end
    where id = h.street_id;
  end if;
  if p_session is not null then
    update public.canvass_sessions set last_house_id = p_house,
      visited = visited + case when p_kind = 'visit' then 1 else 0 end,
      skipped = skipped + case when p_kind = 'skip' then 1 else 0 end
    where id = p_session and user_id = me and ended_at is null;
  end if;
  return h;
end $$;

-- 5) Nota en una casa
create or replace function public.add_house_note(p_house uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare h public.street_houses; n text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
begin
  if not public.is_active() then raise exception 'Usuario no activo'; end if;
  if n is null then raise exception 'La nota está vacía'; end if;
  select * into h from public.street_houses where id = p_house;
  if not found then raise exception 'Casa no encontrada'; end if;
  update public.street_houses set last_note = n, updated_at = now() where id = p_house;
  insert into public.house_events(house_id, street_id, kind, note, actor) values (p_house, h.street_id, 'note', n, auth.uid());
end $$;

-- 6) Asignar vendedor (solo staff)
create or replace function public.assign_house(p_house uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h public.street_houses; who text;
begin
  if not public.is_staff() then raise exception 'Solo la oficina puede asignar vendedores'; end if;
  if p_user is not null and not exists (select 1 from public.profiles where id = p_user and active) then raise exception 'Vendedor no válido'; end if;
  select * into h from public.street_houses where id = p_house for update;
  if not found then raise exception 'Casa no encontrada'; end if;
  update public.street_houses set assigned_to = p_user, updated_at = now() where id = p_house;
  select full_name into who from public.profiles where id = p_user;
  insert into public.house_events(house_id, street_id, kind, note, actor)
  values (p_house, h.street_id, 'assign', coalesce('Asignada a ' || who, 'Sin asignar'), auth.uid());
end $$;

-- 7) Enlazar casa con un trabajo existente (lead) que el usuario puede ver
create or replace function public.link_house_job(p_house uuid, p_job uuid, p_kind text default 'lead')
returns void language plpgsql security definer set search_path = public as $$
declare h public.street_houses;
begin
  if not public.is_active() then raise exception 'Usuario no activo'; end if;
  if p_kind not in ('lead','appointment') then raise exception 'Tipo no válido'; end if;
  if not public.can_see_job(p_job) then raise exception 'No puedes ver ese trabajo'; end if;
  select * into h from public.street_houses where id = p_house for update;
  if not found then raise exception 'Casa no encontrada'; end if;
  update public.street_houses set job_id = p_job,
    status = case when p_kind = 'appointment' then 'appointment'
                  when status in ('not_visited','visited','no_answer') then 'interested' else status end,
    status_updated_at = now(), status_updated_by = auth.uid(), updated_at = now()
  where id = p_house;
  insert into public.house_events(house_id, street_id, kind, status, note, actor)
  values (p_house, h.street_id, p_kind, case when p_kind = 'appointment' then 'appointment' else null end, null, auth.uid());
  update public.canvass_sessions set leads = leads + case when p_kind = 'lead' then 1 else 0 end,
    appointments = appointments + case when p_kind = 'appointment' then 1 else 0 end, last_house_id = p_house
  where user_id = auth.uid() and street_id = h.street_id and ended_at is null;
end $$;

revoke all on function public.set_house_status(uuid, text, text, text, uuid, timestamptz) from public;
revoke all on function public.add_house_note(uuid, text) from public;
revoke all on function public.assign_house(uuid, uuid) from public;
revoke all on function public.link_house_job(uuid, uuid, text) from public;
grant execute on function public.set_house_status(uuid, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.add_house_note(uuid, text) to authenticated;
grant execute on function public.assign_house(uuid, uuid) to authenticated;
grant execute on function public.link_house_job(uuid, uuid, text) to authenticated;

-- =====================================================================
-- REVERTIR (no borra casas ni dueños):
-- drop function if exists public.set_house_status(uuid, text, text, text, uuid, timestamptz);
-- drop function if exists public.add_house_note(uuid, text);
-- drop function if exists public.assign_house(uuid, uuid);
-- drop function if exists public.link_house_job(uuid, uuid, text);
-- drop table if exists public.canvass_sessions;
-- drop table if exists public.house_events;
-- alter table public.street_houses drop constraint if exists street_houses_status_chk,
--   drop column if exists status, drop column if exists status_updated_at, drop column if exists status_updated_by,
--   drop column if exists assigned_to, drop column if exists job_id, drop column if exists last_note;
-- =====================================================================
