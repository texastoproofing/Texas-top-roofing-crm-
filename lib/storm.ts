// Storm Intelligence: tipos, geometría, Storm Opportunity Score y cruce leads–tormentas.
// Funciones puras: se usan en el navegador con los datos que el usuario puede ver.
import { distanceM } from "./map.ts";

export type StormEvent = {
  id: string; source_key: string; event_type: "granizo" | "viento"; event_date: string; observed_at: string | null;
  lat: number; lng: number; hail_in: number | null; wind_mph: number | null; location_text: string | null;
  county: string | null; zip: string | null; data_quality: string; precision_note: string | null; published_at: string | null;
};
export type Swath = { id: string; source_key: string; event_date: string; min_hail_in: number; geom: [number, number][]; bbox: number[] };
export type ZipInfo = { zip: string; name: string | null; geom: [number, number][] | null; bbox: number[] | null };
export type ZipStat = { zip: string; event_date: string; source_key: string; max_hail_in: number; frac_1: number; frac_175: number; frac_25: number };
export type Weights = { intensidad: number; frecuencia: number; recencia: number; resultados: number; leads: number; cobertura: number };
export type Assignment = { id: string; zip: string; rep_id: string; rep_name: string | null; starts_on: string; ends_on: string | null };
export type StormJob = {
  id: string; number: number; customer: string; address: string; zip: string | null; status: string; job_type: string;
  repId: string | null; repName: string | null; lat: number | null; lng: number | null;
};

export const DEFAULT_WEIGHTS: Weights = { intensidad: 30, frecuencia: 20, recencia: 15, resultados: 15, leads: 10, cobertura: 10 };
export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  intensidad: "Intensidad meteorológica documentada", frecuencia: "Frecuencia de eventos", recencia: "Recencia del último evento",
  resultados: "Resultados comerciales históricos", leads: "Concentración de leads abiertos", cobertura: "Cobertura de vendedores",
};

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// ---------------- Geometría ----------------
export function pointInRing(lat: number, lng: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inBbox = (lat: number, lng: number, b: number[] | null) => !!b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];

export function zipOfPoint(lat: number, lng: number, zips: ZipInfo[]): string | null {
  for (const z of zips) if (z.geom && inBbox(lat, lng, z.bbox) && pointInRing(lat, lng, z.geom)) return z.zip;
  return null;
}

// ---------------- Etapas comerciales (estados existentes del CRM) ----------------
const LEAD = ["lead_nuevo", "contactado", "inspeccion_agendada"];
const INSPECTED = ["inspeccionado", "reclamo_abierto", "ajustador", "desk_adjuster", "estimado_enviado"];
const APPROVED = ["aprobado", "suplemento"];
const SIGNED = ["contrato_firmado", "materiales", "instalacion_agendada", "en_instalacion", "facturado", "pago_parcial", "completado"];
const DONE = ["completado"];
export const stageOf = (s: string) =>
  LEAD.includes(s) ? "lead" : INSPECTED.includes(s) ? "inspeccionado" : APPROVED.includes(s) ? "aprobado" : SIGNED.includes(s) ? "firmado" : "perdido";

// ---------------- Filtros de período ----------------
export type Period = { from: string; to: string };
export function periodFromPreset(preset: string, today: string, historyStart: string): Period {
  const d = new Date(today + "T12:00:00Z");
  const back = (days: number) => new Date(d.getTime() - days * 86400000).toISOString().slice(0, 10);
  switch (preset) {
    case "30": return { from: back(30), to: today };
    case "90": return { from: back(90), to: today };
    case "180": return { from: back(182), to: today };
    case "365": return { from: back(365), to: today };
    case "730": return { from: back(730), to: today };
    default: return { from: historyStart, to: today };
  }
}
export const inPeriod = (date: string, p: Period) => date >= p.from && date <= p.to;

// ---------------- Storm Opportunity Score por ZIP ----------------
export type ZipScore = {
  zip: string; name: string | null; hasOutline: boolean;
  radarDays: number; radarMax: number; bestF1: number; bestF175: number; bestF25: number; bestRadarDate: string | null;
  hailReports: number; hailMax: number; windReports: number; windMax: number; eventDays: number; lastEvent: string | null;
  jobs: number; openLeads: number; inspected: number; approved: number; signed: number; completed: number;
  assigned: string | null;
  intensity: number; frequency: number; recency: number; results: number; leadsConc: number; coverage: number;
  exposureScore: number; commercialScore: number; combinedScore: number; confidenceScore: number;
  reasons: string[]; confidenceNotes: string[];
};

export function scoreZips(args: {
  zips: ZipInfo[]; stats: ZipStat[]; events: StormEvent[]; eventZip: Map<string, string | null>;
  jobs: StormJob[]; assignments: Assignment[]; weights: Weights; period: Period; today: string;
}): ZipScore[] {
  const { zips, stats, events, eventZip, jobs, assignments, weights, period, today } = args;
  const zipSet = new Map(zips.map((z) => [z.zip, z]));
  const allZips = new Set<string>([...zipSet.keys()]);
  jobs.forEach((j) => j.zip && allZips.add(j.zip));
  const normHail = (s: number) => clamp((s - 0.75) / 2.0);

  const rows: ZipScore[] = [];
  for (const zip of allZips) {
    const st = stats.filter((s) => s.zip === zip && inPeriod(s.event_date, period));
    const radar = st.filter((s) => s.frac_1 >= 0.05);
    const ev = events.filter((e) => eventZip.get(e.id) === zip && inPeriod(e.event_date, period));
    const hail = ev.filter((e) => e.event_type === "granizo" && e.hail_in != null);
    const wind = ev.filter((e) => e.event_type === "viento");
    const days = new Set<string>([...radar.map((s) => s.event_date), ...hail.map((e) => e.event_date), ...wind.filter((e) => (e.wind_mph ?? 0) >= 58).map((e) => e.event_date)]);
    const lastEvent = [...days].sort().pop() ?? null;

    let radarInt = 0, best: ZipStat | null = null;
    for (const s of radar) {
      const v = 0.35 * normHail(Number(s.max_hail_in)) + 0.40 * Number(s.frac_175) + 0.25 * Number(s.frac_25);
      if (v > radarInt) { radarInt = v; best = s; }
    }
    const hailMax = Math.max(0, ...hail.map((e) => Number(e.hail_in)));
    const windMax = Math.max(0, ...wind.map((e) => e.wind_mph ?? 0));
    const groundInt = hailMax ? 0.9 * normHail(hailMax) : 0;
    const windInt = windMax >= 58 ? 0.5 * clamp((windMax - 50) / 40) : 0;
    const intensity = Math.max(radarInt, groundInt, windInt);
    const frequency = clamp(days.size / 4);
    const recency = lastEvent ? clamp(1 - daysBetween(lastEvent, today) / 730) : 0;

    const zj = jobs.filter((j) => j.zip === zip);
    const by = (k: string) => zj.filter((j) => stageOf(j.status) === k).length;
    const openLeads = by("lead"), inspected = by("inspeccionado"), approved = by("aprobado"), signed = by("firmado");
    const completed = zj.filter((j) => DONE.includes(j.status)).length;
    const wins = approved + signed;
    const results = zj.length ? (wins + 0.4) / (zj.length + 2) : 0.2; // con poca historia se acerca a un valor neutro
    const assign = assignments.find((a) => a.zip === zip && !a.ends_on);
    rows.push({
      zip, name: zipSet.get(zip)?.name ?? null, hasOutline: !!zipSet.get(zip)?.geom,
      radarDays: radar.length, radarMax: Math.max(0, ...radar.map((s) => Number(s.max_hail_in))),
      bestF1: best ? Number(best.frac_1) : 0, bestF175: best ? Number(best.frac_175) : 0, bestF25: best ? Number(best.frac_25) : 0,
      bestRadarDate: best?.event_date ?? null,
      hailReports: hail.length, hailMax, windReports: wind.length, windMax, eventDays: days.size, lastEvent,
      jobs: zj.length, openLeads, inspected, approved, signed, completed,
      assigned: assign?.rep_name ?? null,
      intensity, frequency, recency, results, leadsConc: 0, coverage: assign ? 1 : 0,
      exposureScore: 0, commercialScore: 0, combinedScore: 0, confidenceScore: 0, reasons: [], confidenceNotes: [],
    });
  }

  const maxLeads = Math.max(1, ...rows.map((r) => r.openLeads));
  const W = weights, sum = (...k: (keyof Weights)[]) => k.reduce((a, x) => a + Math.max(0, W[x]), 0) || 1;
  for (const r of rows) {
    r.leadsConc = r.openLeads / maxLeads;
    r.exposureScore = Math.round(100 * (W.intensidad * r.intensity + W.frecuencia * r.frequency + W.recencia * r.recency) / sum("intensidad", "frecuencia", "recencia"));
    r.commercialScore = Math.round(100 * (W.resultados * r.results + W.leads * r.leadsConc + W.cobertura * r.coverage) / sum("resultados", "leads", "cobertura"));
    r.combinedScore = Math.round(100 * (W.intensidad * r.intensity + W.frecuencia * r.frequency + W.recencia * r.recency +
      W.resultados * r.results + W.leads * r.leadsConc + W.cobertura * r.coverage) / sum("intensidad", "frecuencia", "recencia", "resultados", "leads", "cobertura"));

    // Confianza de los datos (no es probabilidad de daño)
    let conf = 0;
    const notes: string[] = [];
    if (r.radarDays) { conf += 30; notes.push("Hay estimación por radar (HailPoint) en el período."); }
    if (r.hailReports || r.windReports) { conf += 35; notes.push(`Hay ${r.hailReports + r.windReports} reporte(s) observados (NWS/SPC/NOAA) dentro del ZIP.`); }
    const radarDates = new Set(stats.filter((s) => s.zip === r.zip && s.frac_1 >= 0.05 && inPeriod(s.event_date, period)).map((s) => s.event_date));
    const groundDates = new Set(events.filter((e) => eventZip.get(e.id) === r.zip && inPeriod(e.event_date, period)).map((e) => e.event_date));
    if ([...radarDates].some((d) => groundDates.has(d))) { conf += 20; notes.push("Radar y reportes en tierra coinciden en al menos una fecha."); }
    if (r.hasOutline) { conf += 15; notes.push("El ZIP tiene contorno del Censo para ubicar reportes."); }
    else notes.push("Sin contorno de ZIP cargado: solo cuentan reportes con ZIP indicado.");
    if (!r.radarDays && !r.hailReports && !r.windReports) notes.push("Sin datos meteorológicos en el período.");
    r.confidenceScore = Math.min(100, conf);
    r.confidenceNotes = notes;

    const reasons: string[] = [];
    if (r.radarDays) reasons.push(`Radar: hasta ${r.radarMax.toFixed(2)}" estimado; ${Math.round(r.bestF175 * 100)}% del ZIP ≥1.75" el ${r.bestRadarDate} (estimación, no medición).`);
    if (r.hailReports) reasons.push(`${r.hailReports} reporte(s) de granizo observados, máximo ${r.hailMax.toFixed(2)}".`);
    if (r.windReports) reasons.push(`${r.windReports} reporte(s) de viento, máximo ${r.windMax || "sin dato"} mph.`);
    reasons.push(r.eventDays ? `${r.eventDays} día(s) con evento; último: ${r.lastEvent}.` : "Sin eventos relevantes en el período.");
    reasons.push(r.jobs ? `${r.jobs} trabajo(s) en el CRM: ${r.openLeads} leads abiertos, ${r.inspected} inspeccionados, ${r.approved} aprobados, ${r.signed} firmados.` : "Sin historial comercial en este ZIP (resultado neutro).");
    reasons.push(r.assigned ? `Asignado a ${r.assigned}.` : "Sin vendedor asignado.");
    r.reasons = reasons;
  }
  return rows.sort((a, b) => b.combinedScore - a.combinedScore || b.exposureScore - a.exposureScore);
}

// ---------------- Cruce lead–tormenta ----------------
export type Exposure = "sin_evidencia" | "historica_cerca" | "exposicion_potencial";
export type FollowUp = "inspeccion_recomendada" | "inspeccion_realizada" | "dano_documentado" | null;
export const EXPOSURE_LABEL: Record<Exposure, string> = {
  sin_evidencia: "Sin evidencia de tormenta",
  historica_cerca: "Tormenta histórica cerca",
  exposicion_potencial: "Exposición potencial",
};
export const EXPOSURE_COLOR: Record<Exposure, string> = { sin_evidencia: "#9ca3af", historica_cerca: "#f59e0b", exposicion_potencial: "#dc2626" };
export const FOLLOWUP_LABEL: Record<Exclude<FollowUp, null>, string> = {
  inspeccion_recomendada: "Inspección recomendada",
  inspeccion_realizada: "Inspección realizada",
  dano_documentado: "Daño documentado (reclamo aprobado)",
};

export type LeadExposure = {
  job: StormJob; exposure: Exposure; followUp: FollowUp;
  swathHits: { date: string; min: number }[];
  near: { id: string; date: string; type: string; hail: number | null; wind: number | null; distM: number; source: string; quality: string }[];
  zipRadar: { date: string; max: number; f1: number } | null;
  reason: string;
};

export function leadExposure(job: StormJob, swaths: Swath[], events: StormEvent[], stats: ZipStat[], period: Period): LeadExposure | null {
  if (job.lat == null || job.lng == null) return null;
  const p = { lat: job.lat, lng: job.lng };
  const swathHits = swaths
    .filter((s) => inPeriod(s.event_date, period) && inBbox(p.lat, p.lng, s.bbox) && pointInRing(p.lat, p.lng, s.geom))
    .map((s) => ({ date: s.event_date, min: Number(s.min_hail_in) }))
    .sort((a, b) => b.min - a.min || b.date.localeCompare(a.date));
  const near = events
    .filter((e) => inPeriod(e.event_date, period) && Math.abs(e.lat - p.lat) < 0.06 && Math.abs(e.lng - p.lng) < 0.07)
    .map((e) => ({ id: e.id, date: e.event_date, type: e.event_type, hail: e.hail_in != null ? Number(e.hail_in) : null, wind: e.wind_mph, distM: distanceM(p, e), source: e.source_key, quality: e.data_quality }))
    .filter((e) => e.distM <= 4828) // 3 millas
    .sort((a, b) => a.distM - b.distM);
  const zr = stats.filter((s) => s.zip === job.zip && inPeriod(s.event_date, period) && s.frac_1 >= 0.05)
    .sort((a, b) => Number(b.max_hail_in) - Number(a.max_hail_in))[0];
  const zipRadar = zr ? { date: zr.event_date, max: Number(zr.max_hail_in), f1: Number(zr.frac_1) } : null;

  const close = near.filter((e) => e.distM <= 1609 && ((e.hail ?? 0) >= 1 || (e.wind ?? 0) >= 58));
  let exposure: Exposure = "sin_evidencia";
  let reason = "No hay franjas de radar ni reportes a menos de 3 millas en el período.";
  if (swathHits.length || close.length) {
    exposure = "exposicion_potencial";
    reason = swathHits.length
      ? `La propiedad está dentro de una franja estimada por radar de ${swathHits[0].min.toFixed(2)}"+ el ${swathHits[0].date}.`
      : `Reporte observado a ${(close[0].distM / 1609).toFixed(1)} mi (${close[0].hail ? close[0].hail + '" granizo' : close[0].wind + " mph viento"}) el ${close[0].date}.`;
  } else if (near.length || zipRadar) {
    exposure = "historica_cerca";
    reason = near.length
      ? `Reporte a ${(near[0].distM / 1609).toFixed(1)} mi el ${near[0].date}.`
      : `El radar estimó granizo ≥1" en parte del ZIP ${job.zip} el ${zipRadar!.date} (no necesariamente en esta casa).`;
  }
  // El estado de daño solo viene del trabajo real (inspección o reclamo aprobado), nunca del mapa.
  const stage = stageOf(job.status);
  let followUp: FollowUp = null;
  if (job.job_type === "seguro" && (stage === "aprobado" || stage === "firmado")) followUp = "dano_documentado";
  else if (stage === "inspeccionado" || stage === "aprobado" || stage === "firmado") followUp = "inspeccion_realizada";
  else if (stage === "lead" && exposure === "exposicion_potencial") followUp = "inspeccion_recomendada";
  return { job, exposure, followUp, swathHits, near, zipRadar, reason };
}

// ---------------- CSV ----------------
export function toCsv(rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");
}
