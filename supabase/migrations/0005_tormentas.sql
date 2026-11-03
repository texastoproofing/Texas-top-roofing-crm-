-- =====================================================================
-- Texas Top Roofing CRM · Storm Intelligence (módulo independiente)
-- Separa datos OBSERVADOS (reportes NWS/SPC/NOAA), ESTIMADOS (radar HailPoint)
-- y COMERCIALES (trabajos del CRM, que ya viven en sus propias tablas).
-- Reversible: ver el bloque "REVERTIR" al final.
-- =====================================================================

-- Fuentes de datos
create table if not exists public.storm_sources (
  key text primary key,
  name text not null,
  kind text not null check (kind in ('observado','estimado')),
  url text,
  notes text
);
insert into public.storm_sources (key, name, kind, url, notes) values
  ('spc', 'NOAA Storm Prediction Center – reportes locales de tormenta (preliminares)', 'observado',
   'https://www.spc.noaa.gov/climo/reports/', 'Reportes preliminares de NWS (granizo en pulgadas, viento en mph). Son puntos, no áreas.'),
  ('compilado', 'Reportes NWS/NOAA compilados manualmente (nov-2024 a nov-2026)', 'observado',
   null, 'Reportes de NWS/SPC/NOAA Storm Events reunidos en la investigación inicial. Incluye nivel de precisión.'),
  ('hailpoint', 'HailPoint – estimación de granizo por radar', 'estimado',
   'https://hailpoint.com', 'Áreas estimadas por radar. No son mediciones en tierra.'),
  ('census_zcta', 'US Census Bureau – ZCTA (áreas de ZIP), contorno simplificado', 'observado',
   'https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html', 'Aproximación oficial de ZIP codes; contorno simplificado.')
on conflict (key) do update set name = excluded.name, kind = excluded.kind, url = excluded.url, notes = excluded.notes;

-- Eventos puntuales observados (reportes de granizo o viento)
create table if not exists public.storm_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.storm_sources(key),
  external_id text not null,                -- id estable para evitar duplicados
  event_type text not null check (event_type in ('granizo','viento')),
  observed_at timestamptz,                  -- hora del reporte (UTC)
  event_date date not null,                 -- fecha local de Texas
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  hail_in numeric(4,2) check (hail_in is null or hail_in between 0 and 8),
  wind_mph int check (wind_mph is null or wind_mph between 0 and 250),
  location_text text,
  county text,
  state text default 'TX',
  zip text,
  data_quality text not null default 'reportado' check (data_quality in ('medido','observado','estimado','reportado')),
  precision_note text,
  comments text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, external_id)
);
create index if not exists storm_events_date_idx on public.storm_events(event_date desc);
create index if not exists storm_events_latlng_idx on public.storm_events(lat, lng);

-- Áreas estimadas por radar (no se generan a partir de un solo reporte)
create table if not exists public.storm_swaths (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.storm_sources(key),
  event_date date not null,
  min_hail_in numeric(4,2) not null,
  geom jsonb not null,                      -- [[lat,lng], ...] anillo exterior
  bbox double precision[] not null,         -- {s,w,n,e}
  external_id text not null,
  unique (source_key, external_id)
);
create index if not exists storm_swaths_date_idx on public.storm_swaths(event_date desc);

-- Contornos de ZIP (ZCTA del Censo, simplificados)
create table if not exists public.zip_boundaries (
  zip text primary key,
  name text,
  geom jsonb,                               -- [[lat,lng], ...] o null si no hay contorno cargado
  bbox double precision[],
  source_key text references public.storm_sources(key)
);

-- Estadística de granizo por ZIP y fecha (radar HailPoint)
create table if not exists public.zip_hail_stats (
  zip text not null,
  event_date date not null,
  source_key text not null references public.storm_sources(key),
  max_hail_in numeric(4,2) not null,
  frac_1 numeric(5,4) not null default 0,    -- fracción del ZIP con granizo estimado >= 1"
  frac_175 numeric(5,4) not null default 0,  -- >= 1.75"
  frac_25 numeric(5,4) not null default 0,   -- >= 2.5"
  primary key (zip, event_date, source_key)
);

-- Configuración del Storm Opportunity Score y de alertas (una sola fila)
create table if not exists public.storm_settings (
  id int primary key default 1 check (id = 1),
  weights jsonb not null default '{"intensidad":30,"frecuencia":20,"recencia":15,"resultados":15,"leads":10,"cobertura":10}',
  alert_min_hail_in numeric(4,2) not null default 1.00,
  alert_min_wind_mph int not null default 58,
  sync_bbox double precision[] not null default '{29.2,-98.9,31.4,-96.9}',  -- s,w,n,e: San Antonio a Temple
  history_start date not null default '2024-01-01',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.storm_settings (id) values (1) on conflict (id) do nothing;

-- Asignación de ZIP a vendedores (sin duplicados activos por ZIP)
create table if not exists public.zip_assignments (
  id uuid primary key default gen_random_uuid(),
  zip text not null,
  rep_id uuid not null references public.profiles(id),
  starts_on date not null default (now() at time zone 'America/Chicago')::date,
  ends_on date,
  notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index if not exists zip_assignments_one_open on public.zip_assignments(zip) where ends_on is null;

-- Alertas internas (una por evento → sin duplicados)
create table if not exists public.storm_alerts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.storm_events(id) on delete cascade,
  title text not null,
  zips text[] not null default '{}',
  leads_nearby int not null default 0,
  is_realtime boolean not null default false,  -- false = reporte histórico publicado después
  status text not null default 'nueva' check (status in ('nueva','revisada')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

-- Registro de sincronizaciones
create table if not exists public.storm_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.storm_sources(key),
  range_start date,
  range_end date,
  status text not null default 'en_curso' check (status in ('en_curso','ok','error','parcial')),
  inserted int not null default 0,
  skipped int not null default 0,
  error text,
  started_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists storm_sync_jobs_started_idx on public.storm_sync_jobs(source_key, started_at desc);

-- Auditoría de cambios de configuración
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor uuid references public.profiles(id) default auth.uid(),
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Seguridad
--   Todos los usuarios activos leen datos meteorológicos.
--   Solo el administrador cambia configuración, asignaciones y sincroniza.
-- ---------------------------------------------------------------------
alter table public.storm_sources enable row level security;
alter table public.storm_events enable row level security;
alter table public.storm_swaths enable row level security;
alter table public.zip_boundaries enable row level security;
alter table public.zip_hail_stats enable row level security;
alter table public.storm_settings enable row level security;
alter table public.zip_assignments enable row level security;
alter table public.storm_alerts enable row level security;
alter table public.storm_sync_jobs enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['storm_sources','storm_events','storm_swaths','zip_boundaries','zip_hail_stats','storm_settings','zip_assignments','storm_alerts','storm_sync_jobs']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select using (public.is_active())', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Cualquier usuario activo puede marcar una alerta como revisada
drop policy if exists storm_alerts_review on public.storm_alerts;
create policy storm_alerts_review on public.storm_alerts for update using (public.is_active()) with check (public.is_active());

drop policy if exists audit_logs_admin_read on public.audit_logs;
create policy audit_logs_admin_read on public.audit_logs for select using (public.is_admin());
drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert with check (public.is_active() and actor = auth.uid());

-- ---------------------------------------------------------------------
-- REVERTIR (solo si se quiere quitar el módulo; borra datos de tormentas):
-- drop table if exists public.storm_alerts, public.storm_sync_jobs, public.zip_assignments,
--   public.storm_settings, public.zip_hail_stats, public.zip_boundaries, public.storm_swaths,
--   public.storm_events, public.storm_sources, public.audit_logs cascade;
-- ---------------------------------------------------------------------
