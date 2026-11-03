-- =====================================================================
-- Sales Performance & Leaderboard
-- Solo agrega tablas. No cambia trabajos, contactos ni permisos existentes.
-- Datos financieros: solo administrador. Comisiones: administrador o el propio vendedor.
-- REVERTIR: ver bloque al final.
-- =====================================================================

-- 1) Historial estructurado de estados (fecha en que cada trabajo llegó a cada etapa)
create table if not exists public.job_status_history (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id),
  source text not null default 'trigger' check (source in ('trigger','actividad','creacion','estado_actual'))
);
create index if not exists jsh_job_idx on public.job_status_history(job_id, changed_at);
create index if not exists jsh_to_idx on public.job_status_history(to_status, changed_at);
alter table public.job_status_history enable row level security;
drop policy if exists jsh_read on public.job_status_history;
create policy jsh_read on public.job_status_history for select using (public.is_active() and public.can_see_job(job_id));

create or replace function public.track_job_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_status_history(job_id, from_status, to_status, changed_at, changed_by, source)
    values (new.id, null, new.status, coalesce(new.created_at, now()), auth.uid(), 'creacion');
  elsif new.status is distinct from old.status then
    insert into public.job_status_history(job_id, from_status, to_status, changed_at, changed_by, source)
    values (new.id, old.status, new.status, now(), auth.uid(), 'trigger');
  end if;
  return null;
end $$;
drop trigger if exists jobs_status_history on public.jobs;
create trigger jobs_status_history after insert or update of status on public.jobs
  for each row execute function public.track_job_status();

-- Relleno con datos reales: creación + cambios registrados en la bitácora ("a → b")
insert into public.job_status_history(job_id, from_status, to_status, changed_at, changed_by, source)
select j.id, null, 'lead_nuevo', j.created_at, j.created_by, 'creacion'
from public.jobs j
where not exists (select 1 from public.job_status_history h where h.job_id = j.id);
insert into public.job_status_history(job_id, from_status, to_status, changed_at, changed_by, source)
select a.job_id, split_part(a.body, ' → ', 1), split_part(a.body, ' → ', 2), a.created_at, a.author_id, 'actividad'
from public.activities a
where a.kind = 'cambio_estado' and a.job_id is not null and a.body like '% → %'
  and not exists (select 1 from public.job_status_history h where h.job_id = a.job_id and h.source = 'actividad' and h.changed_at = a.created_at);
-- Si el estado actual no aparece en la bitácora (p. ej. importado de Trello), se registra con su fecha conocida
insert into public.job_status_history(job_id, from_status, to_status, changed_at, source)
select j.id, null, j.status, j.status_changed_at, 'estado_actual'
from public.jobs j
where j.status <> 'lead_nuevo'
  and not exists (select 1 from public.job_status_history h where h.job_id = j.id and h.to_status = j.status);

-- 2) Datos del vendedor (no sensibles)
create table if not exists public.rep_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  hire_date date,
  supervisor_id uuid references public.profiles(id),
  territory_id uuid references public.territories(id),
  updated_at timestamptz not null default now()
);
alter table public.rep_profiles enable row level security;
drop policy if exists rep_profiles_read on public.rep_profiles;
create policy rep_profiles_read on public.rep_profiles for select using (public.is_active());
drop policy if exists rep_profiles_admin on public.rep_profiles;
create policy rep_profiles_admin on public.rep_profiles for all using (public.is_admin()) with check (public.is_admin());

-- 3) Planes de comisión por vendedor con vigencia (no se aplica ninguno por defecto)
create table if not exists public.commission_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  model text not null check (model in ('profit_pct','sales_pct','fixed','mixed')),
  profit_pct numeric(5,2) check (profit_pct is null or profit_pct between 0 and 100),
  sales_pct numeric(5,2) check (sales_pct is null or sales_pct between 0 and 100),
  fixed_amount numeric(12,2) check (fixed_amount is null or fixed_amount >= 0),
  valid_from date not null,
  valid_to date,
  notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists commission_plans_user_idx on public.commission_plans(user_id, valid_from desc);
alter table public.commission_plans enable row level security;
drop policy if exists cplans_read on public.commission_plans;
create policy cplans_read on public.commission_plans for select using (public.is_admin() or user_id = auth.uid());
drop policy if exists cplans_admin on public.commission_plans;
create policy cplans_admin on public.commission_plans for all using (public.is_admin()) with check (public.is_admin());

-- 4) Finanzas por trabajo (valor del contrato y costos directos): solo administrador
create table if not exists public.job_financials (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  contract_amount numeric(12,2) check (contract_amount is null or contract_amount >= 0),
  direct_costs numeric(12,2) check (direct_costs is null or direct_costs >= 0),
  notes text,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.job_financials enable row level security;
drop policy if exists jfin_admin on public.job_financials;
create policy jfin_admin on public.job_financials for all using (public.is_admin()) with check (public.is_admin());

-- 5) Pagos recibidos (dinero realmente cobrado)
create table if not exists public.job_payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount <> 0),
  received_on date not null,
  method text,
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists job_payments_job_idx on public.job_payments(job_id);
create index if not exists job_payments_date_idx on public.job_payments(received_on);
alter table public.job_payments enable row level security;
drop policy if exists jpay_read on public.job_payments;
create policy jpay_read on public.job_payments for select using (public.is_active() and public.can_see_job(job_id));
drop policy if exists jpay_admin_insert on public.job_payments;
create policy jpay_admin_insert on public.job_payments for insert with check (public.is_admin());
-- Sin update/delete: una corrección se registra como pago negativo

-- 6) Ventas compartidas (si no hay filas, 100% al vendedor del trabajo)
create table if not exists public.job_splits (
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  share_pct numeric(5,2) not null check (share_pct > 0 and share_pct <= 100),
  primary key (job_id, user_id)
);
alter table public.job_splits enable row level security;
drop policy if exists jsplit_read on public.job_splits;
create policy jsplit_read on public.job_splits for select using (public.is_active() and public.can_see_job(job_id));
drop policy if exists jsplit_admin on public.job_splits;
create policy jsplit_admin on public.job_splits for all using (public.is_admin()) with check (public.is_admin());

-- 7) Libro de comisiones (auditable: solo se agregan movimientos, nunca se editan ni borran)
create table if not exists public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('aprobada','pago','ajuste','reverso')),
  amount numeric(12,2) not null,
  basis jsonb,          -- foto del cálculo: valor, costos, profit, modelo, % (para que cambios futuros no alteren el pasado)
  note text,
  created_by uuid not null references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists centries_user_idx on public.commission_entries(user_id, created_at desc);
create index if not exists centries_job_idx on public.commission_entries(job_id);
alter table public.commission_entries enable row level security;
drop policy if exists centries_read on public.commission_entries;
create policy centries_read on public.commission_entries for select using (public.is_admin() or user_id = auth.uid());
drop policy if exists centries_insert on public.commission_entries;
create policy centries_insert on public.commission_entries for insert with check (public.is_admin() and created_by = auth.uid());

-- 8) Metas mensuales (user_id nulo = meta del equipo)
create table if not exists public.sales_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  metric text not null check (metric in ('volumen','contratos','aprobados','inspecciones','techos','convertidos')),
  target numeric(12,2) not null check (target > 0),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists sales_goals_uniq on public.sales_goals(coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), month, metric);
alter table public.sales_goals enable row level security;
drop policy if exists goals_read on public.sales_goals;
create policy goals_read on public.sales_goals for select using (public.is_admin() or user_id = auth.uid() or user_id is null);
drop policy if exists goals_admin on public.sales_goals;
create policy goals_admin on public.sales_goals for all using (public.is_admin()) with check (public.is_admin());

-- 9) Ajustes del módulo
create table if not exists public.sales_settings (
  id int primary key default 1 check (id = 1),
  min_sample int not null default 5 check (min_sample between 1 and 100),
  stalled_days int not null default 14 check (stalled_days between 1 and 365),
  updated_at timestamptz not null default now()
);
insert into public.sales_settings(id) values (1) on conflict (id) do nothing;
alter table public.sales_settings enable row level security;
drop policy if exists ssettings_read on public.sales_settings;
create policy ssettings_read on public.sales_settings for select using (public.is_active());
drop policy if exists ssettings_admin on public.sales_settings;
create policy ssettings_admin on public.sales_settings for update using (public.is_admin()) with check (public.is_admin());

-- =====================================================================
-- REVERTIR (no toca trabajos ni contactos):
-- drop trigger if exists jobs_status_history on public.jobs;
-- drop function if exists public.track_job_status();
-- drop table if exists public.sales_settings, public.sales_goals, public.commission_entries, public.job_splits,
--   public.job_payments, public.job_financials, public.commission_plans, public.rep_profiles, public.job_status_history;
-- =====================================================================
