-- =====================================================================
-- Texas Top Roofing CRM · Fotos y documentos por trabajo
-- Archivos privados en Supabase Storage (bucket "job-files") y sus datos
-- en public.job_files. Ruta de cada archivo: <job_id>/<uuid>/<nombre>
-- Ejecutar completo en Supabase → SQL Editor (después de 0001 y 0002).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bucket privado con límites de tamaño y tipo (los aplica el servidor de Storage)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-files', 'job-files', false, 26214400, -- 25 MB
  array[
    'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Datos de cada archivo
-- ---------------------------------------------------------------------
create table if not exists public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  category text not null default 'otros'
    check (category in ('techo','estimado','contrato','medidas','otros')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  description text,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  -- la ruta siempre empieza con el id del trabajo
  constraint job_files_path_matches_job check (storage_path like job_id::text || '/%')
);
create index if not exists job_files_job_idx on public.job_files(job_id, created_at desc);

alter table public.job_files enable row level security;

-- Saca el id del trabajo de la ruta "<job_id>/..." sin fallar si no es un uuid
create or replace function public.job_id_from_path(p text) returns uuid
language sql immutable as $$
  select case when split_part(p, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p, '/', 1)::uuid end
$$;

-- ¿La ruta apunta a un trabajo existente que el usuario puede ver?
create or replace function public.can_access_job_path(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and exists (
    select 1 from public.jobs j
    where j.id = public.job_id_from_path(p) and public.can_see_job(j.id)
  )
$$;

-- Ver: quien puede ver el trabajo
drop policy if exists job_files_read on public.job_files;
create policy job_files_read on public.job_files for select
  using (public.is_active() and public.can_see_job(job_id));

-- Subir: quien puede ver el trabajo, a su propio nombre
drop policy if exists job_files_insert on public.job_files;
create policy job_files_insert on public.job_files for insert
  with check (public.is_active() and public.can_see_job(job_id) and uploaded_by = auth.uid());

-- Editar descripción/categoría: quien puede ver el trabajo
drop policy if exists job_files_update on public.job_files;
create policy job_files_update on public.job_files for update
  using (public.is_active() and public.can_see_job(job_id))
  with check (public.is_active() and public.can_see_job(job_id));

-- Eliminar: oficina (admin, PM, asistente) o quien lo subió
drop policy if exists job_files_delete on public.job_files;
create policy job_files_delete on public.job_files for delete
  using (public.is_active() and public.can_see_job(job_id)
         and (public.is_staff() or uploaded_by = auth.uid()));

-- No se puede mover un archivo a otro trabajo ni cambiar su ruta o autor
create or replace function public.job_files_lock() returns trigger
language plpgsql as $$
begin
  if new.job_id <> old.job_id or new.storage_path <> old.storage_path
     or new.uploaded_by is distinct from old.uploaded_by or new.size_bytes <> old.size_bytes then
    raise exception 'Solo se puede cambiar la categoría y la descripción';
  end if;
  return new;
end $$;
drop trigger if exists job_files_lock on public.job_files;
create trigger job_files_lock before update on public.job_files
  for each row execute function public.job_files_lock();

-- ---------------------------------------------------------------------
-- Permisos en Storage (los archivos en sí)
-- ---------------------------------------------------------------------
drop policy if exists "job-files read" on storage.objects;
create policy "job-files read" on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and public.can_access_job_path(name));

drop policy if exists "job-files upload" on storage.objects;
create policy "job-files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and public.can_access_job_path(name));

drop policy if exists "job-files delete" on storage.objects;
create policy "job-files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-files' and public.can_access_job_path(name)
         and (public.is_staff() or owner_id = auth.uid()::text));
-- Sin política de UPDATE: un archivo subido no se puede sobrescribir.
