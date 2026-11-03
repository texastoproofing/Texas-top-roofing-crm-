// Grupos del mapa a partir de los estados que ya existen en el CRM (sin crear estados nuevos).
export type MapGroup = "nuevo" | "contactado" | "seguimiento" | "firmado" | "proceso" | "terminado" | "perdido";

export const MAP_GROUPS: { key: MapGroup; label: string; color: string; statuses: string[]; reference?: boolean }[] = [
  { key: "nuevo", label: "Lead nuevo", color: "#2563eb", statuses: ["lead_nuevo"] },
  { key: "contactado", label: "Contactado", color: "#0891b2", statuses: ["contactado"] },
  {
    key: "seguimiento", label: "Seguimiento", color: "#d97706",
    statuses: ["inspeccion_agendada", "inspeccionado", "reclamo_abierto", "ajustador", "desk_adjuster", "estimado_enviado", "aprobado", "suplemento"],
  },
  { key: "firmado", label: "Contrato firmado", color: "#16a34a", statuses: ["contrato_firmado"], reference: true },
  { key: "proceso", label: "Trabajo en proceso", color: "#7c3aed", statuses: ["materiales", "instalacion_agendada", "en_instalacion"], reference: true },
  { key: "terminado", label: "Trabajo terminado", color: "#065f46", statuses: ["facturado", "pago_parcial", "completado"], reference: true },
  { key: "perdido", label: "Perdido", color: "#9ca3af", statuses: ["perdido", "denegado"] },
];

export function mapGroupOf(status: string): MapGroup {
  return MAP_GROUPS.find((g) => g.statuses.includes(status))?.key ?? "seguimiento";
}
export const groupInfo = (k: MapGroup) => MAP_GROUPS.find((g) => g.key === k)!;

export const STREET_STATUS: Record<string, { label: string; color: string; dash?: string }> = {
  pendiente: { label: "Calle pendiente", color: "#6b7280", dash: "2 4" },
  en_progreso: { label: "Calle con visitas (en progreso)", color: "#f59e0b" },
  terminada: { label: "Calle terminada", color: "#16a34a" },
};

// Dirección que se geocodifica: la de la propiedad (trabajo) o, si falta, la del contacto
export function addressInput(p: { address?: string | null; city?: string | null; zip?: string | null; state?: string | null }) {
  const a = (p.address ?? "").trim();
  if (!a || !/\d/.test(a)) return null; // sin número de casa no se puede ubicar una propiedad
  const city = (p.city ?? "").trim();
  const zip = (p.zip ?? "").trim();
  if (!city && !zip) return null;
  return [a, city, `${(p.state ?? "TX").trim() || "TX"} ${zip}`.trim()].filter(Boolean).join(", ");
}

export const normInput = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function fmtDistance(m: number) {
  const mi = m / 1609.34;
  if (mi < 0.1) return `${Math.round(m * 3.281)} ft`;
  return `${mi.toFixed(mi < 1 ? 2 : 1)} mi`;
}

export type LatLng = { lat: number; lng: number };
export const isLatLng = (v: any): v is LatLng =>
  v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;

// Enlaces de navegación
export function googleDirUrl(origin: LatLng | null, stops: LatLng[]) {
  if (!stops.length) return null;
  const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const dest = stops[stops.length - 1];
  const way = stops.slice(0, -1);
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1");
  if (origin) u.searchParams.set("origin", ll(origin));
  u.searchParams.set("destination", ll(dest));
  if (way.length) u.searchParams.set("waypoints", way.map(ll).join("|"));
  u.searchParams.set("travelmode", "driving");
  return u.toString();
}
export const appleDirUrl = (origin: LatLng | null, dest: LatLng) =>
  `https://maps.apple.com/?${origin ? `saddr=${origin.lat},${origin.lng}&` : ""}daddr=${dest.lat},${dest.lng}&dirflg=d`;

// Google Maps acepta hasta 9 paradas intermedias por enlace: se parte en tramos de 10
export function chunkStops<T>(stops: T[], size = 10) {
  const out: T[][] = [];
  for (let i = 0; i < stops.length; i += size) out.push(stops.slice(i, i + size));
  return out;
}
