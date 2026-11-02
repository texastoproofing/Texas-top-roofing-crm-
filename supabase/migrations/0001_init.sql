-- =====================================================================
-- Texas Top Roofing CRM · Etapa 1 (MVP)
-- Modelo inspirado en JobNimbus: Contactos → Trabajos (con workflow),
-- Tareas, Citas, Actividad. Más Territorios door-to-door.
-- Ejecutar completo en Supabase → SQL Editor.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Perfiles y roles
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  role text not null default 'vendedor'
    check (role in ('administrador','vendedor','project_manager','asistente')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Rol del usuario actual (security definer para evitar recursión en RLS)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'administrador', false)
$$;

-- Personal de oficina: ve todo
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('administrador','project_manager','asistente'), false)
$$;

-- Crea el perfil al registrarse/invitar. El PRIMER usuario queda como administrador.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.profiles;
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.email,
    case when n = 0 then 'administrador'
         else coalesce(new.raw_user_meta_data->>'role','vendedor') end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Territorios (zonas de tormenta y calles para door-to-door)
-- ---------------------------------------------------------------------
create table if not exists public.territories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  city text,
  zip text,
  hail text,                -- tamaño según radar, ej. "3.00–3.25″"
  storm_date date,
  priority int not null default 100,
  schedule text,            -- ej. "Lunes", "Semana 2"
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.territory_streets (
  id uuid primary key default gen_random_uuid(),
  territory_id uuid not null references public.territories(id) on delete cascade,
  name text not null,
  position int not null default 0,
  status text not null default 'pendiente'
    check (status in ('pendiente','en_progreso','terminada')),
  doors_knocked int not null default 0,
  leads int not null default 0,
  notes text,
  last_visit_at timestamptz,
  last_visit_by uuid references public.profiles(id),
  unique (territory_id, name)
);

-- ---------------------------------------------------------------------
-- Contactos
-- ---------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  company text,
  phone text,
  phone2 text,
  email text,
  address text,
  city text,
  state text default 'TX',
  zip text,
  source text not null default 'otro'
    check (source in ('door_to_door','lead_comprado','referido','trello','web','otro')),
  lead_cost numeric(10,2),
  owner_id uuid references public.profiles(id),
  territory_id uuid references public.territories(id),
  notes text,
  external_ref text unique,     -- id de tarjeta de Trello u otro sistema
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_owner_idx on public.contacts(owner_id);
create index if not exists contacts_zip_idx on public.contacts(zip);

-- ---------------------------------------------------------------------
-- Trabajos (Jobs) con workflow tipo JobNimbus
-- ---------------------------------------------------------------------
create sequence if not exists public.job_number_seq start 1001;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  number int not null default nextval('public.job_number_seq') unique,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  name text not null,
  job_type text not null default 'seguro' check (job_type in ('seguro','retail')),
  status text not null default 'lead_nuevo',
  status_changed_at timestamptz not null default now(),
  sales_rep_id uuid references public.profiles(id),
  pm_id uuid references public.profiles(id),
  address text,
  city text,
  zip text,
  territory_id uuid references public.territories(id),
  storm_date date,
  -- Seguro
  insurer text,
  policy_number text,
  claim_number text,
  date_of_loss date,
  adjuster_name text,
  adjuster_phone text,
  adjuster_email text,
  -- Dinero (etapa 1: solo referencia)
  estimate_amount numeric(12,2),
  approved_amount numeric(12,2),
  deductible numeric(12,2),
  notes text,
  external_ref text unique,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_status_idx on public.jobs(status);
create index if not exists jobs_rep_idx on public.jobs(sales_rep_id);
create index if not exists jobs_contact_idx on public.jobs(contact_id);

-- ---------------------------------------------------------------------
-- Actividad (notas y bitácora)
-- ---------------------------------------------------------------------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  author_id uuid references public.profiles(id) default auth.uid(),
  kind text not null default 'nota'
    check (kind in ('nota','llamada','visita','cambio_estado','sistema')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists activities_job_idx on public.activities(job_id, created_at desc);
create index if not exists activities_contact_idx on public.activities(contact_id, created_at desc);

-- ---------------------------------------------------------------------
-- Tareas
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_at timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  assigned_to uuid references public.profiles(id),
  job_id uuid references public.jobs(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to, done, due_at);

-- ---------------------------------------------------------------------
-- Citas (calendario)
-- ---------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'inspeccion'
    check (kind in ('inspeccion','ajustador','firma','instalacion','seguimiento','otra')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  assigned_to uuid references public.profiles(id),
  job_id uuid references public.jobs(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists appointments_starts_idx on public.appointments(starts_at);

-- ---------------------------------------------------------------------
-- Disparadores: updated_at y bitácora de cambio de estado
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();
drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

create or replace function public.log_job_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
    insert into public.activities (job_id, contact_id, author_id, kind, body)
    values (new.id, new.contact_id, auth.uid(), 'cambio_estado', old.status || ' → ' || new.status);
  end if;
  return new;
end $$;
drop trigger if exists jobs_status_log on public.jobs;
create trigger jobs_status_log before update on public.jobs
  for each row execute function public.log_job_status();

-- ---------------------------------------------------------------------
-- Seguridad (RLS)
--   administrador / project_manager / asistente: ven y editan todo
--   vendedor: ve y edita sus contactos y trabajos (dueño, asignado o creador)
--   solo administrador borra y cambia roles
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.territories enable row level security;
alter table public.territory_streets enable row level security;
alter table public.contacts enable row level security;
alter table public.jobs enable row level security;
alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.appointments enable row level security;

-- ¿Puede el usuario ver este contacto?
create or replace function public.can_see_contact(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.contacts x where x.id = c
      and (x.owner_id = auth.uid() or x.created_by = auth.uid())
  ) or exists (
    select 1 from public.jobs j where j.contact_id = c
      and (j.sales_rep_id = auth.uid() or j.created_by = auth.uid())
  )
$$;

create or replace function public.can_see_job(j uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.jobs x where x.id = j
      and (x.sales_rep_id = auth.uid() or x.pm_id = auth.uid() or x.created_by = auth.uid())
  )
$$;

-- profiles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (public.is_active());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = public.my_role() and active);
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- territorios: todos leen; todos actualizan avance de calles; admin crea/borra
drop policy if exists terr_read on public.territories;
create policy terr_read on public.territories for select using (public.is_active());
drop policy if exists terr_admin on public.territories;
create policy terr_admin on public.territories for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists streets_read on public.territory_streets;
create policy streets_read on public.territory_streets for select using (public.is_active());
drop policy if exists streets_update on public.territory_streets;
create policy streets_update on public.territory_streets for update using (public.is_active()) with check (public.is_active());
drop policy if exists streets_admin on public.territory_streets;
create policy streets_admin on public.territory_streets for all using (public.is_admin()) with check (public.is_admin());

-- contactos
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select using (public.is_active() and public.can_see_contact(id));
drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts for insert with check (public.is_active());
drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update using (public.is_active() and public.can_see_contact(id));
drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts for delete using (public.is_admin());

-- trabajos
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (public.is_active() and public.can_see_job(id));
drop policy if exists jobs_insert on public.jobs;
create policy jobs_insert on public.jobs for insert with check (public.is_active());
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update using (public.is_active() and public.can_see_job(id));
drop policy if exists jobs_delete on public.jobs;
create policy jobs_delete on public.jobs for delete using (public.is_admin());

-- actividad
drop policy if exists act_read on public.activities;
create policy act_read on public.activities for select using (
  public.is_active() and (
    (job_id is not null and public.can_see_job(job_id)) or
    (job_id is null and contact_id is not null and public.can_see_contact(contact_id))
  ));
drop policy if exists act_insert on public.activities;
create policy act_insert on public.activities for insert with check (public.is_active() and author_id = auth.uid());
drop policy if exists act_delete on public.activities;
create policy act_delete on public.activities for delete using (public.is_admin() or author_id = auth.uid());

-- tareas
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select using (
  public.is_active() and (public.is_staff() or assigned_to = auth.uid() or created_by = auth.uid()
    or (job_id is not null and public.can_see_job(job_id))));
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert with check (public.is_active());
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update using (
  public.is_active() and (public.is_staff() or assigned_to = auth.uid() or created_by = auth.uid()));
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete using (public.is_admin() or created_by = auth.uid());

-- citas
drop policy if exists appt_read on public.appointments;
create policy appt_read on public.appointments for select using (
  public.is_active() and (public.is_staff() or assigned_to = auth.uid() or created_by = auth.uid()
    or (job_id is not null and public.can_see_job(job_id))));
drop policy if exists appt_insert on public.appointments;
create policy appt_insert on public.appointments for insert with check (public.is_active());
drop policy if exists appt_update on public.appointments;
create policy appt_update on public.appointments for update using (
  public.is_active() and (public.is_staff() or assigned_to = auth.uid() or created_by = auth.uid()));
drop policy if exists appt_delete on public.appointments;
create policy appt_delete on public.appointments for delete using (public.is_admin() or created_by = auth.uid());
