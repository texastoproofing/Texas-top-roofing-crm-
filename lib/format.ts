import { TZ } from "./constants";

export function fullName(c: { first_name?: string | null; last_name?: string | null; company?: string | null } | null | undefined) {
  if (!c) return "—";
  const n = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return n || c.company || "Sin nombre";
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  // Fechas "YYYY-MM-DD" se muestran sin conversión de zona horaria
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-");
    return `${day}/${m}/${y}`;
  }
  return new Date(d).toLocaleDateString("es-US", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-US", {
    timeZone: TZ, weekday: "short", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit",
  });
}

export function fmtTime(d: string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("es-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

export function fmtMoney(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return "—";
  return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// "YYYY-MM-DD" del día de hoy en Texas
export function todayTX() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

// Convierte el valor de un <input type="datetime-local"> (hora de Texas) a ISO UTC
export function localToISO(v: string | null | undefined): string | null {
  if (!v) return null;
  const [date, time = "00:00"] = v.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Calcula el desfase de America/Chicago para ese instante
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asTZ = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = asTZ - guess;
  return new Date(guess - offset).toISOString();
}

// ISO UTC → valor para <input type="datetime-local"> en hora de Texas
export function isoToLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export function telHref(p: string | null | undefined) {
  return p ? "tel:" + p.replace(/[^\d+]/g, "") : undefined;
}

export function mapsHref(parts: (string | null | undefined)[]) {
  const q = parts.filter(Boolean).join(", ");
  return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : undefined;
}

export function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function num(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  if (v === null) return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Nombre visible: el del perfil; si parece un usuario técnico (una sola palabra larga en minúsculas o con números), uno genérico
export function displayName(full: string | null | undefined) {
  const n = (full ?? "").trim();
  if (!n || (!n.includes(" ") && n === n.toLowerCase() && (/\d/.test(n) || n.length >= 14))) return "Equipo Texas Top";
  return n;
}
export const firstName = (full: string | null | undefined) => {
  const d = displayName(full);
  return d === "Equipo Texas Top" ? null : d.split(" ")[0];
};
