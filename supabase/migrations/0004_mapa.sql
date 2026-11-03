-- =====================================================================
-- Texas Top Roofing CRM · Mapa de calles y clientes
-- Ubicaciones (caché de geocodificación), trazos de calles, visitas a
-- calles/tramos, rutas del día y autorización de referencias.
-- Ejecutar completo en Supabase → SQL Editor (después de 0001–0003).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ubicación de cada trabajo (propiedad). "input" es la dirección usada:
-- si la dirección cambia, la app vuelve a geocodificar; si no, reutiliza.
-- ---------------------------------------------------------------------
create table if not exists public.job_locations (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  input text not null,
  status text not null check (status in ('ok','ambigua','sin_resultado','error')),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  matched_address text,
  source text,                 -- 'census', 'census-elegida', 'manual'
  candidates jsonb,            -- opciones cuando la dirección es ambigua
  error text,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint job_locations_ok_has_coords check ((status = 'ok') = (lat is not null and lng is not null))
);
alter table public.job_locations enable row level security;

drop policy if exists job_locations_rw on public.job_locations;
create policy job_locations_rw on public.job_locations for all
  using (public.is_active() and public.can_see_job(job_id))
  with check (public.is_active() and public.can_see_job(job_id));

-- ---------------------------------------------------------------------
-- Autorización de referencia comercial (apagada por defecto)
-- ---------------------------------------------------------------------
alter table public.jobs add column if not exists reference_authorized boolean not null default false;
alter table public.jobs add column if not exists reference_authorized_at timestamptz;
alter table public.jobs add column if not exists reference_authorized_by uuid references public.profiles(id);
alter table public.jobs add column if not exists reference_note text;

-- ---------------------------------------------------------------------
-- Trazo de cada calle del territorio (OpenStreetMap), guardado una vez
-- ---------------------------------------------------------------------
alter table public.territory_streets add column if not exists geom jsonb;  -- [[[lat,lng],...], ...]
alter table public.territory_streets add column if not exists geom_status text not null default 'pendiente';
alter table public.territory_streets add column if not exists geom_updated_at timestamptz;
do $$ begin
  alter table public.territory_streets add constraint territory_streets_geom_status_chk
    check (geom_status in ('pendiente','ok','no_encontrada','error'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Visitas a calles o tramos (una visita NO marca la calle como terminada)
-- ---------------------------------------------------------------------
create table if not exists public.street_visits (
  id uuid primary key default gen_random_uuid(),
  street_id uuid not null references public.territory_streets(id) on delete cascade,
  visited_on date not null default (now() at time zone 'America/Chicago')::date,
  visited_by uuid not null references public.profiles(id) default auth.uid(),
  segment text,          -- tramo: "#1200–1300", "lado norte", "toda la calle"…
  doors int check (doors is null or doors between 0 and 1000),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists street_visits_street_idx on public.street_visits(street_id, visited_on desc);
alter table public.street_visits enable row level security;

drop policy if exists street_visits_read on public.street_visits;
create policy street_visits_read on public.street_visits for select using (public.is_active());
drop policy if exists street_visits_insert on public.street_visits;
create policy street_visits_insert on public.street_visits for insert
  with check (public.is_active() and visited_by = auth.uid());
drop policy if exists street_visits_delete on public.street_visits;
create policy street_visits_delete on public.street_visits for delete
  using (public.is_admin() or visited_by = auth.uid());

-- ---------------------------------------------------------------------
-- Ruta del día por vendedor y fecha
-- ---------------------------------------------------------------------
create table if not exists public.day_routes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) default auth.uid(),
  route_date date not null,
  start_mode text not null default 'ninguno' check (start_mode in ('ninguno','gps','manual')),
  start_label text,
  start_lat double precision check (start_lat between -90 and 90),
  start_lng double precision check (start_lng between -180 and 180),
  stops jsonb not null default '[]'::jsonb,   -- [{"job_id": "..."}] en orden
  order_mode text not null default 'manual' check (order_mode in ('manual','cercania')),
  updated_at timestamptz not null default now(),
  unique (owner_id, route_date)
);
alter table public.day_routes enable row level security;

drop policy if exists day_routes_read on public.day_routes;
create policy day_routes_read on public.day_routes for select
  using (public.is_active() and (owner_id = auth.uid() or public.is_admin() or public.my_role() = 'project_manager'));
drop policy if exists day_routes_write on public.day_routes;
create policy day_routes_write on public.day_routes for insert
  with check (public.is_active() and owner_id = auth.uid());
drop policy if exists day_routes_update on public.day_routes;
create policy day_routes_update on public.day_routes for update
  using (public.is_active() and owner_id = auth.uid())
  with check (owner_id = auth.uid());
drop policy if exists day_routes_delete on public.day_routes;
create policy day_routes_delete on public.day_routes for delete
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Trabajos firmados / en proceso / terminados cerca de un trabajo.
-- Devuelve datos seguros: nombre y dirección SOLO si hay autorización.
-- Requiere que quien consulta pueda ver el trabajo de origen.
-- ---------------------------------------------------------------------
create or replace function public.nearby_jobs(p_job uuid, p_radius_m int default 1609)
returns table (
  job_id uuid,            -- solo si quien consulta puede ver ese trabajo
  distance_m int,
  status text,
  street text,            -- nombre de la calle, sin número de casa
  authorized boolean,
  customer_name text,     -- solo con autorización
  address text,           -- solo con autorización
  can_open boolean
)
language plpgsql stable security definer set search_path = public as $$
declare o record;
begin
  if not public.is_active() or not public.can_see_job(p_job) then
    return;
  end if;
  select lat, lng into o from public.job_locations where job_locations.job_id = p_job and job_locations.status = 'ok';
  if o.lat is null then return; end if;

  return query
  with near as (
    select j.id, j.status, j.address, j.city, j.reference_authorized, c.first_name, c.last_name,
           (6371000 * 2 * asin(sqrt(
              power(sin(radians(l.lat - o.lat) / 2), 2) +
              cos(radians(o.lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - o.lng) / 2), 2)
           )))::int as d
    from public.jobs j
    join public.job_locations l on l.job_id = j.id and l.status = 'ok'
    join public.contacts c on c.id = j.contact_id
    where j.id <> p_job
      and j.status in ('contrato_firmado','materiales','instalacion_agendada','en_instalacion','facturado','pago_parcial','completado')
      and l.lat between o.lat - 0.2 and o.lat + 0.2
      and l.lng between o.lng - 0.2 and o.lng + 0.2
  )
  select
    case when public.can_see_job(n.id) then n.id end,
    n.d,
    n.status,
    nullif(trim(regexp_replace(coalesce(n.address, ''), '^\s*[0-9]+[a-zA-Z-]*\s+', '')), ''),
    n.reference_authorized,
    case when n.reference_authorized then trim(coalesce(n.first_name,'') || ' ' || coalesce(n.last_name,'')) end,
    case when n.reference_authorized then concat_ws(', ', n.address, n.city) end,
    public.can_see_job(n.id)
  from near n
  where n.d <= p_radius_m
  order by n.d
  limit 25;
end $$;

revoke all on function public.nearby_jobs(uuid, int) from public;
grant execute on function public.nearby_jobs(uuid, int) to authenticated;
