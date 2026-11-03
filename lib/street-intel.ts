// Street Intelligence: estados por casa, orden de recorrido, historial de tormentas por calle
// y prioridad de prospección. Funciones puras (se prueban en tests/street-intel.test.ts).

export const HOUSE_STATUS = {
  not_visited: { label: "Sin visitar", en: "Not Visited", color: "#6b7280", bg: "#f3f4f6", icon: "circle" },
  visited: { label: "Visitada", en: "Visited", color: "#2563eb", bg: "#dbeafe", icon: "door" },
  no_answer: { label: "No abrió", en: "No Answer", color: "#a16207", bg: "#fef9c3", icon: "clock" },
  interested: { label: "Interesado", en: "Interested", color: "#16a34a", bg: "#dcfce7", icon: "check" },
  appointment: { label: "Cita agendada", en: "Appointment", color: "#7c3aed", bg: "#ede9fe", icon: "calendar" },
  customer: { label: "Cliente", en: "Customer", color: "#14532d", bg: "#bbf7d0", icon: "trophy" },
  do_not_contact: { label: "No contactar", en: "Do Not Contact", color: "#dc2626", bg: "#fee2e2", icon: "x" },
} as const;
export type HouseStatus = keyof typeof HOUSE_STATUS;
export const HOUSE_STATUS_KEYS = Object.keys(HOUSE_STATUS) as HouseStatus[];
export const isHouseStatus = (s: unknown): s is HouseStatus => typeof s === "string" && s in HOUSE_STATUS;

// Estados que cuentan como "trabajada" (alguien ya tocó esa puerta)
export const WORKED: HouseStatus[] = ["visited", "no_answer", "interested", "appointment", "customer", "do_not_contact"];
// Estados que siguen pendientes en un recorrido (vale la pena tocar)
export const PENDING_IN_ROUTE: HouseStatus[] = ["not_visited", "no_answer"];

export type HouseLite = { id: string; house_number: number | null; situs: string; status: HouseStatus };

export function houseCounts(houses: { status: HouseStatus }[]) {
  const by = Object.fromEntries(HOUSE_STATUS_KEYS.map((k) => [k, 0])) as Record<HouseStatus, number>;
  for (const h of houses) by[h.status] = (by[h.status] ?? 0) + 1;
  const total = houses.length;
  const worked = WORKED.reduce((n, k) => n + by[k], 0);
  return { total, by, worked, pending: total - worked, pct: total ? Math.round((worked / total) * 100) : 0 };
}

/**
 * Orden básico (sin API de rutas): un lado de la calle subiendo de número y el otro bajando,
 * para caminar en "U". Casas sin número al final. "No contactar" nunca entra.
 * Las casas "No abrió" van después de las "Sin visitar" (segunda pasada).
 */
export function canvassOrder<T extends HouseLite>(houses: T[]): T[] {
  const ok = houses.filter((h) => PENDING_IN_ROUTE.includes(h.status));
  const pass = (list: T[]) => {
    const odd = list.filter((h) => h.house_number != null && h.house_number % 2 === 1).sort((a, b) => a.house_number! - b.house_number!);
    const even = list.filter((h) => h.house_number != null && h.house_number % 2 === 0).sort((a, b) => b.house_number! - a.house_number!);
    const none = list.filter((h) => h.house_number == null).sort((a, b) => a.situs.localeCompare(b.situs));
    // Empieza por el lado que tenga el número más bajo
    const oddFirst = !even.length || (odd.length > 0 && odd[0].house_number! <= even[even.length - 1].house_number!);
    return oddFirst ? [...odd, ...even, ...none] : [...even.slice().reverse(), ...odd.slice().reverse(), ...none];
  };
  return [...pass(ok.filter((h) => h.status === "not_visited")), ...pass(ok.filter((h) => h.status === "no_answer"))];
}
export const ORDER_NOTE = "Orden básico por número de casa: un lado de la calle y luego el otro. No usa una API de rutas.";

/** Siguiente casa a partir de la última trabajada (continuar donde lo dejé). */
export function nextHouse<T extends HouseLite>(order: T[], lastId: string | null, skipped: Set<string> = new Set()): T | null {
  const list = order.filter((h) => !skipped.has(h.id));
  if (!list.length) return null;
  if (!lastId) return list[0];
  const i = order.findIndex((h) => h.id === lastId);
  if (i < 0) return list[0];
  return order.slice(i + 1).find((h) => !skipped.has(h.id)) ?? list[0];
}

// ---------------- Geometría de la calle ----------------
type LL = [number, number];
const R = 6371000, toR = Math.PI / 180;
export function distM(a: LL, b: LL) {
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function streetNodes(lines: LL[][]): LL[] { return lines.flat(); }
export function streetCentroid(lines: LL[][]): LL | null {
  const n = streetNodes(lines);
  if (!n.length) return null;
  return [n.reduce((s, p) => s + p[0], 0) / n.length, n.reduce((s, p) => s + p[1], 0) / n.length];
}
/** Distancia mínima de un punto a los nodos de la calle (aprox.; suficiente para calles cortas). */
export function distToStreet(p: LL, lines: LL[][]) {
  let best = Infinity;
  for (const q of streetNodes(lines)) best = Math.min(best, distM(p, q));
  return best;
}
export function pointInRing(lat: number, lng: number, ring: LL[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------- Historial de tormentas por calle ----------------
export type StormCard = {
  key: string; date: string; type: "granizo" | "viento";
  kind: "observado" | "estimado";
  sizeIn: number | null; windMph: number | null;
  source: string; confidence: "alta" | "media" | "baja";
  distanceMi: number | null; place: string | null; note: string | null;
  focus: { lat: number; lng: number } | { bbox: number[] } | null;
};
export type EventIn = { id: string; source_key: string; event_type: "granizo" | "viento"; event_date: string; lat: number; lng: number; hail_in: number | null; wind_mph: number | null; location_text: string | null; data_quality: string | null; comments: string | null };
export type SwathIn = { id: string; source_key: string; event_date: string; min_hail_in: number; geom: LL[]; bbox: number[] };

export const SOURCE_NAME: Record<string, string> = {
  spc: "NOAA SPC (reporte NWS)", compilado: "NWS/NOAA (compilado)", hailpoint: "HailPoint (radar)", nexrad: "NOAA NEXRAD (radar)",
};
export const STORM_RADIUS_MI = 3;

export function streetStormHistory(lines: LL[][], events: EventIn[], swaths: SwathIn[], radiusMi = STORM_RADIUS_MI): StormCard[] {
  const nodes = streetNodes(lines);
  if (!nodes.length) return [];
  const cards: StormCard[] = [];
  for (const e of events) {
    const d = distToStreet([e.lat, e.lng], lines) / 1609.34;
    if (d > radiusMi) continue;
    const measured = e.data_quality === "medido";
    cards.push({
      key: `e-${e.id}`, date: e.event_date, type: e.event_type, kind: "observado",
      sizeIn: e.event_type === "granizo" && e.hail_in != null ? Number(e.hail_in) : null,
      windMph: e.event_type === "viento" && e.wind_mph != null ? Number(e.wind_mph) : null,
      source: SOURCE_NAME[e.source_key] ?? e.source_key,
      // Reporte en tierra: alta si está a ≤1 mi o fue medido; media si está más lejos
      confidence: measured || d <= 1 ? "alta" : "media",
      distanceMi: Math.round(d * 10) / 10, place: e.location_text, note: e.comments,
      focus: { lat: e.lat, lng: e.lng },
    });
  }
  // Radar: una tarjeta por fecha y fuente con el tamaño máximo cuya área toca algún punto de la calle
  const best = new Map<string, SwathIn>();
  for (const s of swaths) {
    const [s0, w0, n0, e0] = s.bbox ?? [];
    const touches = nodes.some(([la, ln]) => (s.bbox ? la >= s0 && la <= n0 && ln >= w0 && ln <= e0 : true) && pointInRing(la, ln, s.geom));
    if (!touches) continue;
    const k = `${s.event_date}|${s.source_key}`;
    const cur = best.get(k);
    if (!cur || s.min_hail_in > cur.min_hail_in) best.set(k, s);
  }
  for (const s of best.values()) {
    cards.push({
      key: `s-${s.id}`, date: s.event_date, type: "granizo", kind: "estimado",
      sizeIn: Number(s.min_hail_in), windMph: null,
      source: SOURCE_NAME[s.source_key] ?? s.source_key,
      confidence: s.source_key === "hailpoint" ? "media" : "baja",
      distanceMi: 0, place: null, note: `Área estimada de ${Number(s.min_hail_in).toFixed(2)}" o más cubre la calle`,
      focus: s.bbox ? { bbox: s.bbox } : null,
    });
  }
  return cards.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === "observado" ? -1 : 1));
}

// ---------------- Prioridad de prospección ----------------
// Criterios visibles y ajustables. NO confirma daños: solo ordena dónde conviene tocar primero.
export const PRIORITY_WEIGHTS = { granizo: 45, recencia: 25, pendientes: 20, interes: 10 };
export const PRIORITY_WINDOW_DAYS = 730;

export function streetPriority(args: {
  cards: StormCard[]; counts: ReturnType<typeof houseCounts>; today: string;
  weights?: typeof PRIORITY_WEIGHTS;
}) {
  const w = args.weights ?? PRIORITY_WEIGHTS;
  const t = Date.parse(args.today);
  const recent = args.cards.filter((c) => c.type === "granizo" && c.sizeIn != null && (t - Date.parse(c.date)) / 86400000 <= PRIORITY_WINDOW_DAYS);
  const maxHail = recent.reduce((m, c) => Math.max(m, c.sizeIn ?? 0), 0);
  const lastDate = recent.map((c) => c.date).sort().reverse()[0] ?? null;
  const days = lastDate ? (t - Date.parse(lastDate)) / 86400000 : null;
  const { total, pending, by } = args.counts;
  const parts = [
    { key: "granizo", label: "Granizo más grande (2 años)", value: maxHail ? `${maxHail.toFixed(2)}"` : "sin datos", score: w.granizo * Math.min(1, Math.max(0, (maxHail - 0.75) / 1.75)) },
    { key: "recencia", label: "Qué tan reciente", value: days == null ? "sin datos" : `hace ${Math.round(days)} días`, score: days == null ? 0 : w.recencia * Math.max(0, 1 - days / PRIORITY_WINDOW_DAYS) },
    { key: "pendientes", label: "Casas sin trabajar", value: total ? `${pending} de ${total}` : "sin casas cargadas", score: total ? w.pendientes * (pending / total) : 0 },
    { key: "interes", label: "Interesados o citas", value: `${by.interested + by.appointment}`, score: w.interes * Math.min(1, (by.interested + by.appointment) / 3) },
  ];
  const score = Math.round(parts.reduce((s, p) => s + p.score, 0));
  const level = !recent.length ? "sin_datos" : score >= 60 ? "alta" : score >= 35 ? "media" : "baja";
  return { score, level, parts: parts.map((p) => ({ ...p, score: Math.round(p.score) })), max: Object.values(w).reduce((a, b) => a + b, 0) };
}
export const PRIORITY_LABEL = { alta: "Prioridad alta", media: "Prioridad media", baja: "Prioridad baja", sin_datos: "Sin datos de granizo" } as const;

/** Normaliza una dirección para buscar leads existentes ("123 Oak Ln" ≈ "123 OAK LANE"). */
export function addrKey(s: string | null | undefined) {
  if (!s) return "";
  const ABBR: Record<string, string> = { street: "st", lane: "ln", drive: "dr", road: "rd", avenue: "ave", court: "ct", circle: "cir", boulevard: "blvd", place: "pl", trail: "trl", parkway: "pkwy", cove: "cv", grove: "grv", terrace: "ter", way: "way", loop: "lp", run: "run", pass: "pass", path: "path" };
  const line = String(s).split(",")[0].toLowerCase().replace(/[.#]/g, " ").replace(/\s+/g, " ").trim();
  return line.split(" ").map((w) => ABBR[w] ?? w).join(" ");
}
