-- Casas de cada calle door-to-door con el dueño según el distrito de tasación del condado (registro público).
-- Solo se guarda: dirección, nombre del dueño, dirección postal del dueño, si es su residencia (exención homestead) y año de construcción.
-- NO se guardan otras exenciones (edad, discapacidad, veteranos) ni valores.
create table if not exists public.street_houses (
  id uuid primary key default gen_random_uuid(),
  street_id uuid not null references public.territory_streets(id) on delete cascade,
  source text not null default 'bexar_cad',
  prop_id text not null,
  house_number int,
  situs text not null,
  owner_name text,
  owner_mailing text,
  owner_occupied boolean,
  year_built int,
  updated_at timestamptz not null default now(),
  unique (source, prop_id)
);
create index if not exists street_houses_street_idx on public.street_houses(street_id, house_number);
alter table public.territory_streets add column if not exists owners_loaded_at timestamptz;
alter table public.territory_streets add column if not exists owners_status text;

alter table public.street_houses enable row level security;
drop policy if exists street_houses_read on public.street_houses;
create policy street_houses_read on public.street_houses for select using (public.is_active());
drop policy if exists street_houses_admin on public.street_houses;
create policy street_houses_admin on public.street_houses for all using (public.is_admin()) with check (public.is_admin());

-- REVERTIR:
-- drop table if exists public.street_houses;
-- alter table public.territory_streets drop column if exists owners_loaded_at, drop column if exists owners_status;
