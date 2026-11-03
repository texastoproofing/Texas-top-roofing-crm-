"use server";
import { revalidatePath } from "next/cache";
import { getSession, isStaff } from "@/lib/auth";
import {
  FILES_BUCKET, isCategory, isUuid, safeStorageName, validateFile,
} from "@/lib/files";

type Result = { ok: true } | { ok: false; error: string };

const pathFor = (jobId: string, fileId: string, name: string) => `${jobId}/${fileId}/${safeStorageName(name)}`;

// Se llama después de que el navegador subió el archivo a Storage.
// Revalida todo en el servidor; si algo no cuadra, borra el archivo para no dejar huérfanos.
export async function registerJobFile(input: {
  jobId: string; fileId: string; name: string; size: number; type: string;
  category: string; description?: string | null;
}): Promise<Result> {
  const { supabase, profile } = await getSession();
  const { jobId, fileId, name, size, type, category } = input;
  if (!isUuid(jobId) || !isUuid(fileId) || typeof name !== "string" || !name.trim()) {
    return { ok: false, error: "Datos de carga inválidos." };
  }
  const path = pathFor(jobId, fileId, name);
  const discard = async () => { await supabase.storage.from(FILES_BUCKET).remove([path]); };

  if (!isCategory(category)) { await discard(); return { ok: false, error: "Categoría no válida." }; }
  const v = validateFile(name, type, Number(size));
  if (!v.ok) { await discard(); return { ok: false, error: v.error }; }

  // ¿El usuario puede ver este trabajo? (RLS)
  const { data: job } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
  if (!job) { await discard(); return { ok: false, error: "No tienes acceso a este trabajo." }; }

  // ¿El archivo realmente está en Storage con el tamaño y tipo declarados?
  const { data: listed, error: listErr } = await supabase.storage.from(FILES_BUCKET).list(`${jobId}/${fileId}`);
  const obj = (listed ?? []).find((o) => o.name === safeStorageName(name));
  if (listErr || !obj) return { ok: false, error: "El archivo no llegó al almacenamiento. Intenta de nuevo." };
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  if (Number(meta.size) !== Number(size) || (meta.mimetype && meta.mimetype !== v.mime)) {
    await discard();
    return { ok: false, error: "El archivo guardado no coincide con el que se subió. Intenta de nuevo." };
  }

  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) || null : null;
  const { error } = await supabase.from("job_files").insert({
    job_id: jobId, category, file_name: name.trim().slice(0, 200), storage_path: path,
    mime_type: v.mime, size_bytes: Number(size), description, uploaded_by: profile.id,
  });
  if (error) { await discard(); return { ok: false, error: "No se pudo guardar el registro del archivo." }; }

  revalidatePath(`/trabajos/${jobId}`);
  return { ok: true };
}

// El navegador lo usa si la subida a Storage terminó pero el registro no se pudo crear.
export async function discardUpload(jobId: string, fileId: string, name: string): Promise<void> {
  const { supabase } = await getSession();
  if (!isUuid(jobId) || !isUuid(fileId)) return;
  const path = pathFor(jobId, fileId, name);
  const { data: row } = await supabase.from("job_files").select("id").eq("storage_path", path).maybeSingle();
  if (!row) await supabase.storage.from(FILES_BUCKET).remove([path]);
}

export async function updateJobFile(id: string, input: { description?: string | null; category?: string }): Promise<Result> {
  const { supabase } = await getSession();
  if (!isUuid(id)) return { ok: false, error: "Archivo no válido." };
  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = (input.description ?? "").trim().slice(0, 500) || null;
  if (input.category !== undefined) {
    if (!isCategory(input.category)) return { ok: false, error: "Categoría no válida." };
    patch.category = input.category;
  }
  const { data, error } = await supabase.from("job_files").update(patch).eq("id", id).select("job_id").maybeSingle();
  if (error || !data) return { ok: false, error: "No se pudo guardar el cambio." };
  revalidatePath(`/trabajos/${data.job_id}`);
  return { ok: true };
}

export async function deleteJobFile(id: string): Promise<Result> {
  const { supabase, profile } = await getSession();
  if (!isUuid(id)) return { ok: false, error: "Archivo no válido." };
  const { data: row } = await supabase.from("job_files")
    .select("id, job_id, storage_path, uploaded_by").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "El archivo no existe o no tienes acceso." };
  if (!isStaff(profile) && row.uploaded_by !== profile.id) {
    return { ok: false, error: "Solo quien lo subió o la oficina pueden eliminarlo." };
  }
  // Primero el archivo, luego el registro: así nunca queda un registro apuntando a nada.
  const { data: removed, error: rmErr } = await supabase.storage.from(FILES_BUCKET).remove([row.storage_path]);
  if (rmErr) return { ok: false, error: "No se pudo eliminar el archivo. Intenta de nuevo." };
  void removed;
  const { error } = await supabase.from("job_files").delete().eq("id", id);
  if (error) return { ok: false, error: "Se borró el archivo pero no su registro. Recarga e intenta de nuevo." };
  revalidatePath(`/trabajos/${row.job_id}`);
  return { ok: true };
}

// Borra subidas que nunca se registraron (por ejemplo, si se cerró la app a mitad de la carga).
export async function cleanupOrphanUploads(jobId: string): Promise<void> {
  const { supabase } = await getSession();
  if (!isUuid(jobId)) return;
  const [{ data: folders }, { data: rows }] = await Promise.all([
    supabase.storage.from(FILES_BUCKET).list(jobId, { limit: 1000 }),
    supabase.from("job_files").select("storage_path").eq("job_id", jobId),
  ]);
  const known = new Set((rows ?? []).map((r) => r.storage_path.split("/")[1]));
  const cutoff = Date.now() - 60 * 60 * 1000; // más de 1 hora sin registrarse
  for (const f of folders ?? []) {
    if (!isUuid(f.name) || known.has(f.name)) continue;
    const { data: inner } = await supabase.storage.from(FILES_BUCKET).list(`${jobId}/${f.name}`);
    const old = (inner ?? []).filter((o) => o.created_at && new Date(o.created_at).getTime() < cutoff)
      .map((o) => `${jobId}/${f.name}/${o.name}`);
    if (old.length) await supabase.storage.from(FILES_BUCKET).remove(old);
  }
}
