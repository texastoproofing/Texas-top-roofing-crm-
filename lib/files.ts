// Reglas de "Fotos y documentos" compartidas por el navegador y el servidor.

export const FILES_BUCKET = "job-files";
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB (igual que el bucket)

export type FileCategory = "techo" | "estimado" | "contrato" | "medidas" | "otros";

export const FILE_CATEGORIES: { key: FileCategory; label: string; short: string }[] = [
  { key: "techo", label: "Fotos del techo", short: "Techo" },
  { key: "estimado", label: "Estimado de la aseguradora", short: "Estimado" },
  { key: "contrato", label: "Contrato firmado", short: "Contrato" },
  { key: "medidas", label: "Reporte de medidas", short: "Medidas" },
  { key: "otros", label: "Otros documentos", short: "Otros" },
];

export const categoryLabel = (k: string) => FILE_CATEGORIES.find((c) => c.key === k)?.label ?? k;
export const isCategory = (k: unknown): k is FileCategory =>
  typeof k === "string" && FILE_CATEGORIES.some((c) => c.key === k);

// Tipos permitidos (debe coincidir con allowed_mime_types del bucket)
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  heic: "image/heic", heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain", csv: "text/csv",
};
export const ALLOWED_MIME = Array.from(new Set(Object.values(EXT_MIME)));
export const ACCEPT_ATTR = ALLOWED_MIME.join(",") + ",." + Object.keys(EXT_MIME).join(",.");

export function extOf(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

// Algunos teléfonos mandan el tipo vacío o genérico: se deduce por la extensión.
export function resolveMime(name: string, type: string | undefined | null): string | null {
  const t = (type ?? "").toLowerCase();
  if (t && ALLOWED_MIME.includes(t)) return t;
  const byExt = EXT_MIME[extOf(name)];
  return byExt ?? null;
}

export const isImage = (mime: string) => mime.startsWith("image/");
export const isPdf = (mime: string) => mime === "application/pdf";
// HEIC solo se ve en Safari; en otros navegadores se muestra ícono
export const isPreviewableImage = (mime: string) => isImage(mime) && mime !== "image/heic" && mime !== "image/heif";

export function validateFile(name: string, type: string | undefined | null, size: number): { ok: true; mime: string } | { ok: false; error: string } {
  const mime = resolveMime(name, type);
  if (!mime) return { ok: false, error: "Tipo de archivo no permitido. Usa fotos (JPG, PNG, HEIC), PDF, Word, Excel o texto." };
  if (!size || size <= 0) return { ok: false, error: "El archivo está vacío." };
  if (size > MAX_FILE_BYTES) return { ok: false, error: `Pesa ${fmtBytes(size)}. El máximo es 25 MB.` };
  return { ok: true, mime };
}

// Nombre seguro para la ruta en Storage (se conserva el nombre original en la base de datos)
export function safeStorageName(name: string) {
  const ext = extOf(name);
  const base = name.replace(/\.[^.]+$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "archivo";
  return ext ? `${base}.${ext}` : base;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
