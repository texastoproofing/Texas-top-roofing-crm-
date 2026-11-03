import { createClient } from "@/lib/supabase/server";
import { FILES_BUCKET, type FileCategory } from "@/lib/files";
import { JobFiles, type JobFileItem } from "@/components/files/JobFiles";

// Carga los archivos del trabajo (con permisos del usuario) y enlaces firmados de 1 hora.
export async function JobFilesTab({ jobId, me, canDeleteAny }: { jobId: string; me: string; canDeleteAny: boolean }) {
  const supabase = createClient();
  const { data: rows, error } = await supabase.from("job_files")
    .select("id, category, file_name, storage_path, mime_type, size_bytes, description, created_at, uploaded_by, uploader:profiles!job_files_uploaded_by_fkey(full_name)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="card p-6 text-sm text-red-700 bg-red-50">
        No se pudieron cargar los archivos. Si es la primera vez, falta correr <code>supabase/migrations/0003_archivos.sql</code> en Supabase.
      </div>
    );
  }

  const paths = (rows ?? []).map((r) => r.storage_path);
  const view = new Map<string, string>();
  const download = new Map<string, string>();
  if (paths.length) {
    const [v, d] = await Promise.all([
      supabase.storage.from(FILES_BUCKET).createSignedUrls(paths, 3600),
      supabase.storage.from(FILES_BUCKET).createSignedUrls(paths, 3600, { download: true }),
    ]);
    for (const x of v.data ?? []) if (x.path && x.signedUrl) view.set(x.path, x.signedUrl);
    for (const x of d.data ?? []) if (x.path && x.signedUrl) download.set(x.path, x.signedUrl);
  }

  const files: JobFileItem[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    category: r.category as FileCategory,
    file_name: r.file_name,
    mime_type: r.mime_type,
    size_bytes: Number(r.size_bytes),
    description: r.description,
    created_at: r.created_at,
    uploaded_by: r.uploaded_by,
    uploader: r.uploader?.full_name ?? null,
    viewUrl: view.get(r.storage_path) ?? null,
    downloadUrl: download.get(r.storage_path) ?? null,
  }));

  return <JobFiles jobId={jobId} files={files} me={me} canDeleteAny={canDeleteAny} />;
}
