import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FILES_BUCKET } from "./files";

// Al borrar un trabajo o un contacto: quita todos sus archivos de Storage.
export async function removeJobStorage(supabase: SupabaseClient, jobId: string) {
  const { data: folders } = await supabase.storage.from(FILES_BUCKET).list(jobId, { limit: 1000 });
  const paths: string[] = [];
  for (const f of folders ?? []) {
    const { data: inner } = await supabase.storage.from(FILES_BUCKET).list(`${jobId}/${f.name}`);
    for (const o of inner ?? []) paths.push(`${jobId}/${f.name}/${o.name}`);
  }
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(FILES_BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error("No se pudieron borrar los archivos del trabajo. No se eliminó nada.");
  }
}
