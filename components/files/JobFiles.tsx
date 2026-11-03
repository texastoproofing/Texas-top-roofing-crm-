"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPT_ATTR, FILES_BUCKET, FILE_CATEGORIES, categoryLabel, fmtBytes, isImage, isPdf,
  isPreviewableImage, safeStorageName, validateFile, type FileCategory,
} from "@/lib/files";
import { fmtDateTime } from "@/lib/format";
import {
  cleanupOrphanUploads, deleteJobFile, discardUpload, registerJobFile, updateJobFile,
} from "@/app/(app)/trabajos/archivos-actions";

export type JobFileItem = {
  id: string;
  category: FileCategory;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  created_at: string;
  uploaded_by: string | null;
  uploader: string | null;
  viewUrl: string | null;
  downloadUrl: string | null;
};

type QueueItem = {
  key: string;
  file: File;
  category: FileCategory;
  status: "esperando" | "subiendo" | "guardando" | "listo" | "error";
  progress: number;
  error?: string;
};

const EMPTY_TEXT = "Agrega fotos y documentos para respaldar este trabajo y sus suplementos.";

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Subida directa a Storage con barra de progreso (los permisos los revisa Supabase con la sesión del usuario)
function uploadWithProgress(url: string, token: string, apikey: string, file: File, mime: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", apikey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("Content-Type", mime);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = "No se pudo subir el archivo.";
      try {
        const body = JSON.parse(xhr.responseText);
        const m = String(body.message || body.error || "");
        if (/mime|type/i.test(m)) msg = "Tipo de archivo no permitido.";
        else if (/size|large|exceed/i.test(m) || xhr.status === 413) msg = "El archivo supera el máximo de 25 MB.";
        else if (/security|policy|unauthor/i.test(m) || xhr.status === 403) msg = "No tienes permiso para subir archivos a este trabajo.";
        else if (/exists|duplicate/i.test(m)) msg = "Ya existe un archivo con esa ruta. Intenta de nuevo.";
      } catch { /* respuesta no JSON */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Sin conexión o se cortó la señal. Revisa tu internet y reintenta."));
    xhr.ontimeout = () => reject(new Error("La carga tardó demasiado. Reintenta."));
    xhr.send(file);
  });
}

export function JobFiles({ jobId, files, me, canDeleteAny }: {
  jobId: string; files: JobFileItem[]; me: string; canDeleteAny: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"todas" | FileCategory>("todas");
  const [uploadCat, setUploadCat] = useState<FileCategory>("techo");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  // Limpia subidas abandonadas de este trabajo (en segundo plano)
  useEffect(() => { cleanupOrphanUploads(jobId).catch(() => {}); }, [jobId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of files) c[f.category] = (c[f.category] ?? 0) + 1;
    return c;
  }, [files]);

  const shown = filter === "todas" ? files : files.filter((f) => f.category === filter);
  const photos = shown.filter((f) => isImage(f.mime_type));
  const docs = shown.filter((f) => !isImage(f.mime_type));
  const previewList = shown.filter((f) => isPreviewableImage(f.mime_type) || isPdf(f.mime_type));

  const patch = (key: string, p: Partial<QueueItem>) =>
    setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...p } : it)));

  async function runUpload(item: QueueItem) {
    const v = validateFile(item.file.name, item.file.type, item.file.size);
    if (!v.ok) { patch(item.key, { status: "error", error: v.error }); return; }
    patch(item.key, { status: "subiendo", progress: 0, error: undefined });

    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { patch(item.key, { status: "error", error: "Tu sesión expiró. Vuelve a entrar al CRM." }); return; }

    const fileId = uuid();
    const path = `${jobId}/${fileId}/${safeStorageName(item.file.name)}`;
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${FILES_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
    try {
      await uploadWithProgress(url, session.access_token, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, item.file, v.mime,
        (p) => patch(item.key, { progress: p }));
    } catch (e) {
      patch(item.key, { status: "error", error: (e as Error).message });
      return;
    }
    patch(item.key, { status: "guardando", progress: 100 });
    try {
      const res = await registerJobFile({
        jobId, fileId, name: item.file.name, size: item.file.size, type: v.mime, category: item.category,
      });
      if (!res.ok) { patch(item.key, { status: "error", error: res.error }); return; }
      patch(item.key, { status: "listo" });
      router.refresh();
    } catch {
      await discardUpload(jobId, fileId, item.file.name).catch(() => {});
      patch(item.key, { status: "error", error: "No se pudo registrar el archivo. Reintenta." });
    }
  }

  function addFiles(list: FileList | null, category: FileCategory) {
    if (!list || list.length === 0) return;
    const items: QueueItem[] = Array.from(list).map((file) => ({
      key: uuid(), file, category, status: "esperando", progress: 0,
    }));
    setQueue((q) => [...items, ...q.filter((x) => x.status !== "listo")]);
    // De una en una para no saturar la señal del teléfono
    (async () => { for (const it of items) await runUpload(it); })();
  }

  const active = queue.filter((q) => q.status !== "listo");
  const doneCount = queue.filter((q) => q.status === "listo").length;

  return (
    <div className="space-y-5">
      {/* Resumen de lo cargado */}
      <section className="card p-4">
        <h2 className="h2 mb-3">Resumen de archivos cargados</h2>
        <ul className="grid sm:grid-cols-2 gap-2">
          {FILE_CATEGORIES.filter((c) => c.key !== "otros").map((c) => {
            const n = counts[c.key] ?? 0;
            return (
              <li key={c.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${n ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50"}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${n ? "bg-green-600 text-white" : "bg-white border border-gray-300 text-gray-400"}`}>
                  {n ? "✓" : "–"}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{c.label}</div>
                  <div className="text-xs text-gray-600">{n ? `${n} archivo${n === 1 ? "" : "s"} cargado${n === 1 ? "" : "s"}` : "Sin archivos cargados"}</div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-gray-500 mt-3">
          Este resumen solo muestra qué se ha cargado. No confirma que la evidencia sea suficiente ni que los documentos estén revisados o validados.
        </p>
      </section>

      {/* Carga */}
      <section className="card p-4 space-y-3">
        <div>
          <label className="label" htmlFor="upload-cat">Guardar en</label>
          <select id="upload-cat" className="input" value={uploadCat} onChange={(e) => setUploadCat(e.target.value as FileCategory)}>
            {FILE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primary min-h-[56px] text-base" onClick={() => cameraRef.current?.click()}>
            <CameraIcon /> Tomar foto
          </button>
          <button type="button" className="btn-secondary min-h-[56px] text-base" onClick={() => filesRef.current?.click()}>
            <UploadIcon /> Subir archivos
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          data-testid="camera-input"
          onChange={(e) => { addFiles(e.target.files, uploadCat); e.target.value = ""; }} />
        <input ref={filesRef} type="file" accept={ACCEPT_ATTR} multiple className="hidden"
          data-testid="files-input"
          onChange={(e) => { addFiles(e.target.files, uploadCat); e.target.value = ""; }} />
        <p className="text-xs text-gray-500">Fotos (JPG, PNG, HEIC), PDF, Word, Excel o texto. Máximo 25 MB por archivo. Puedes elegir varias a la vez.</p>

        {(active.length > 0 || doneCount > 0) && (
          <ul className="space-y-2" aria-live="polite">
            {doneCount > 0 && active.length === 0 && (
              <li className="rounded-lg bg-green-50 text-green-800 text-sm p-2.5">
                {doneCount} archivo{doneCount === 1 ? "" : "s"} subido{doneCount === 1 ? "" : "s"} correctamente.
              </li>
            )}
            {active.map((it) => (
              <li key={it.key} className={`rounded-lg border p-2.5 text-sm ${it.status === "error" ? "border-red-200 bg-red-50" : "border-gray-200"}`}>
                <div className="flex justify-between gap-2">
                  <span className="font-semibold truncate">{it.file.name}</span>
                  <span className="text-xs text-gray-500 shrink-0">{fmtBytes(it.file.size)}</span>
                </div>
                {it.status !== "error" ? (
                  <>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-1.5">
                      <div className="h-full bg-brand transition-all" style={{ width: `${it.progress}%` }} />
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {it.status === "esperando" ? "En espera…" : it.status === "guardando" ? "Guardando…" : `Subiendo ${it.progress}%`} · {categoryLabel(it.category)}
                    </div>
                  </>
                ) : (
                  <div className="mt-1">
                    <p className="text-red-700">{it.error}</p>
                    <div className="flex gap-2 mt-2">
                      <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => runUpload(it)}>Reintentar</button>
                      <button type="button" className="btn-ghost min-h-[36px] px-3" onClick={() => setQueue((q) => q.filter((x) => x.key !== it.key))}>Quitar</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {notice && (
        <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3 flex justify-between gap-2">
          <span>{notice}</span>
          <button type="button" className="font-semibold" onClick={() => setNotice(null)}>Cerrar</button>
        </p>
      )}

      {/* Filtros */}
      {files.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4" role="tablist" aria-label="Filtrar por categoría">
          {[{ key: "todas" as const, short: "Todas", n: files.length }, ...FILE_CATEGORIES.map((c) => ({ key: c.key, short: c.short, n: counts[c.key] ?? 0 }))].map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={`chip py-1.5 ${filter === c.key ? "bg-gray-900 text-white border-gray-900" : "bg-white"}`}>
              {c.short} <span className="ml-1 opacity-70 tabular-nums">{c.n}</span>
            </button>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <div className="card p-8 text-center text-gray-600">{EMPTY_TEXT}</div>
      ) : shown.length === 0 ? (
        <div className="card p-6 text-center muted">No hay archivos en {categoryLabel(filter)}.</div>
      ) : (
        <>
          {photos.length > 0 && (
            <section>
              <h3 className="font-bold mb-2">Fotos <span className="text-gray-400 font-normal">({photos.length})</span></h3>
              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {photos.map((f) => (
                  <li key={f.id} className="card overflow-hidden">
                    <button type="button" className="block w-full aspect-square bg-gray-100" onClick={() => setPreview(f.id)}
                      aria-label={`Ver ${f.file_name}`}>
                      {isPreviewableImage(f.mime_type) && f.viewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.viewUrl} alt={f.description || f.file_name} loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-xs text-gray-500 p-2">{f.file_name}<br />(vista previa no disponible)</span>
                      )}
                    </button>
                    <div className="p-2 text-xs space-y-0.5">
                      <div className="font-semibold text-gray-800 line-clamp-2">{f.description || f.file_name}</div>
                      <div className="text-gray-500">{FILE_CATEGORIES.find((c) => c.key === f.category)?.short} · {fmtDateTime(f.created_at)}</div>
                      <div className="text-gray-500 truncate">{f.uploader ?? "—"}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {docs.length > 0 && (
            <section>
              <h3 className="font-bold mb-2">Documentos <span className="text-gray-400 font-normal">({docs.length})</span></h3>
              <ul className="card divide-y divide-gray-100">
                {docs.map((f) => (
                  <li key={f.id} className="p-3 flex items-start gap-3">
                    <DocIcon mime={f.mime_type} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold break-words">{f.file_name}</div>
                      <div className="text-xs text-gray-500">{categoryLabel(f.category)} · {fmtBytes(f.size_bytes)}</div>
                      <div className="text-xs text-gray-500">{fmtDateTime(f.created_at)} · {f.uploader ?? "—"}</div>
                      {f.description && <div className="text-sm text-gray-700 mt-1">{f.description}</div>}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {isPdf(f.mime_type) && <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => setPreview(f.id)}>Ver</button>}
                        {f.downloadUrl && <a className="btn-secondary min-h-[36px] px-3" href={f.downloadUrl}>Descargar</a>}
                        <FileActions file={f} me={me} canDeleteAny={canDeleteAny} onError={setNotice} onDone={() => router.refresh()} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {preview && (
        <Lightbox
          list={previewList.some((x) => x.id === preview) ? previewList : shown.filter((x) => x.id === preview)}
          id={preview}
          onClose={() => setPreview(null)}
          onMove={setPreview}
          me={me} canDeleteAny={canDeleteAny}
          onError={setNotice}
          onDone={(deleted) => { if (deleted) setPreview(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function FileActions({ file, me, canDeleteAny, onError, onDone, dark }: {
  file: JobFileItem; me: string; canDeleteAny: boolean; onError: (m: string) => void;
  onDone: (deleted: boolean) => void; dark?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [desc, setDesc] = useState(file.description ?? "");
  const [cat, setCat] = useState<FileCategory>(file.category);
  const [pending, start] = useTransition();
  const canDelete = canDeleteAny || file.uploaded_by === me;
  const btn = dark ? "btn min-h-[36px] px-3 bg-white/10 text-white hover:bg-white/20" : "btn-secondary min-h-[36px] px-3";

  useEffect(() => { setDesc(file.description ?? ""); setCat(file.category); setEditing(false); setConfirming(false); }, [file.id, file.description, file.category]);

  if (editing) {
    return (
      <form className="w-full space-y-2 mt-1" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await updateJobFile(file.id, { description: desc, category: cat });
          if (!r.ok) onError(r.error); else { setEditing(false); onDone(false); }
        });
      }}>
        <textarea className="input py-2 text-gray-900" rows={2} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="Ej.: Daño por granizo en pendiente norte" aria-label="Descripción" />
        <select className="input text-gray-900" value={cat} onChange={(e) => setCat(e.target.value as FileCategory)} aria-label="Categoría">
          {FILE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary min-h-[36px] px-3" disabled={pending}>{pending ? "Guardando…" : "Guardar"}</button>
          <button type="button" className={btn} onClick={() => setEditing(false)}>Cancelar</button>
        </div>
      </form>
    );
  }

  if (confirming) {
    return (
      <div className={`w-full rounded-lg p-2.5 mt-1 ${dark ? "bg-red-900/60 text-white" : "bg-red-50 text-red-800"}`} role="alertdialog" aria-label="Confirmar eliminación">
        <p className="text-sm font-semibold">¿Eliminar “{file.file_name}”? No se puede deshacer.</p>
        <div className="flex gap-2 mt-2">
          <button type="button" className="btn min-h-[36px] px-3 bg-red-600 text-white hover:bg-red-700" disabled={pending}
            onClick={() => start(async () => {
              const r = await deleteJobFile(file.id);
              if (!r.ok) { onError(r.error); setConfirming(false); } else onDone(true);
            })}>
            {pending ? "Eliminando…" : "Sí, eliminar"}
          </button>
          <button type="button" className={btn} onClick={() => setConfirming(false)}>Cancelar</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button type="button" className={btn} onClick={() => setEditing(true)}>Descripción</button>
      {canDelete && (
        <button type="button" className={`${btn} ${dark ? "" : "text-red-600"}`} onClick={() => setConfirming(true)}>Eliminar</button>
      )}
    </>
  );
}

function Lightbox({ list, id, onClose, onMove, me, canDeleteAny, onError, onDone }: {
  list: JobFileItem[]; id: string; onClose: () => void; onMove: (id: string) => void;
  me: string; canDeleteAny: boolean; onError: (m: string) => void; onDone: (deleted: boolean) => void;
}) {
  const idx = Math.max(0, list.findIndex((f) => f.id === id));
  const f = list[idx];
  const prev = list[idx - 1];
  const next = list[idx + 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && prev) onMove(prev.id);
      if (e.key === "ArrowRight" && next) onMove(next.id);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [prev, next, onClose, onMove]);

  if (!f) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 text-white flex flex-col" role="dialog" aria-modal="true" aria-label={f.file_name}>
      <div className="flex items-center justify-between gap-2 px-3 h-14 shrink-0">
        <span className="text-sm truncate">{idx + 1} / {list.length} · {f.file_name}</span>
        <button type="button" className="btn min-h-[40px] px-3 bg-white/10 hover:bg-white/20" onClick={onClose}>Cerrar</button>
      </div>
      <div className="flex-1 min-h-0 relative flex items-center justify-center px-2">
        {isPdf(f.mime_type) && f.viewUrl ? (
          <iframe src={f.viewUrl} title={f.file_name} className="w-full h-full bg-white rounded" />
        ) : isPreviewableImage(f.mime_type) && f.viewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.viewUrl} alt={f.description || f.file_name} className="max-w-full max-h-full object-contain" />
        ) : (
          <p className="text-center text-sm">Vista previa no disponible para este archivo. Usa “Descargar”.</p>
        )}
        {prev && <button type="button" aria-label="Anterior" onClick={() => onMove(prev.id)}
          className="absolute left-1 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 text-2xl">‹</button>}
        {next && <button type="button" aria-label="Siguiente" onClick={() => onMove(next.id)}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 text-2xl">›</button>}
      </div>
      <div className="shrink-0 p-3 space-y-1.5 bg-black/60 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {f.description && <p className="font-semibold">{f.description}</p>}
        <p className="text-xs text-white/70">{categoryLabel(f.category)} · {fmtDateTime(f.created_at)} · {f.uploader ?? "—"} · {fmtBytes(f.size_bytes)}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {f.viewUrl && isPdf(f.mime_type) && <a className="btn min-h-[36px] px-3 bg-white/10 hover:bg-white/20" href={f.viewUrl} target="_blank" rel="noopener">Abrir</a>}
          {f.downloadUrl && <a className="btn min-h-[36px] px-3 bg-white/10 hover:bg-white/20" href={f.downloadUrl}>Descargar</a>}
          <FileActions dark file={f} me={me} canDeleteAny={canDeleteAny} onError={onError} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 16V4m0 0-4 4m4-4 4 4M5 20h14" />
    </svg>
  );
}
function DocIcon({ mime }: { mime: string }) {
  const label = isPdf(mime) ? "PDF" : /word/.test(mime) ? "DOC" : /sheet|excel|csv/.test(mime) ? "XLS" : "TXT";
  const color = isPdf(mime) ? "bg-red-100 text-red-700" : /word/.test(mime) ? "bg-blue-100 text-blue-700" : /sheet|excel|csv/.test(mime) ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700";
  return <span className={`shrink-0 w-11 h-11 rounded-lg flex items-center justify-center text-xs font-bold ${color}`}>{label}</span>;
}
