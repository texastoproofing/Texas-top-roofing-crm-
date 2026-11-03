import "server-only";
import { createAdminClient } from "./supabase/admin";
import { pointInRing } from "./storm";
import type { Region } from "./regions";
import { parseSwdi } from "./region-parse";

const UA = "TexasTopRoofingCRM/1.0 (+https://texas-top-roofing-crm.vercel.app)";
async function get(url: string, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally { clearTimeout(t); }
}

// Nombre postal principal (USPS) de ZIP fuera de la ciudad de San Antonio
const SA_NAMES: Record<string, string> = {
  "78002": "Atascosa", "78004": "Bergheim", "78006": "Boerne", "78009": "Castroville", "78015": "Boerne / Fair Oaks Ranch",
  "78023": "Helotes", "78039": "La Coste", "78052": "Lytle", "78056": "Mico", "78059": "Natalia", "78063": "Pipe Creek",
  "78066": "Rio Medina", "78069": "Somerset", "78070": "Spring Branch", "78073": "Von Ormy", "78101": "Adkins", "78108": "Cibolo",
  "78109": "Converse", "78112": "Elmendorf", "78114": "Floresville", "78121": "La Vernia", "78123": "McQueeney", "78124": "Marion",
  "78130": "New Braunfels", "78132": "New Braunfels", "78133": "Canyon Lake", "78148": "Universal City", "78150": "JBSA Randolph",
  "78152": "Saint Hedwig", "78154": "Schertz", "78155": "Seguin", "78160": "Stockdale", "78161": "Sutherland Springs",
  "78163": "Bulverde", "78638": "Kingsbury", "78666": "San Marcos",
};

const ringArea = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };

// Contornos ZCTA del Censo (TIGERweb). Solo llena ZIP que aún no tienen contorno.
export async function importZipOutlines(region: Region) {
  const [s, w, n, e] = region.bbox;
  const q = new URLSearchParams({
    where: "1=1", geometry: `${w},${s},${e},${n}`, geometryType: "esriGeometryEnvelope", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "ZCTA5", returnGeometry: "true", outSR: "4326",
    maxAllowableOffset: "0.002", geometryPrecision: "4", f: "json",
  });
  const r = await get(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7/query?${q}`, 40000);
  const data: any = await r.json();
  if (!Array.isArray(data?.features)) throw new Error("El Censo no devolvió contornos.");
  const admin = createAdminClient();
  const { data: existing } = await admin.from("zip_boundaries").select("zip, name, geom");
  const have = new Map<string, any>((existing ?? []).map((z: any) => [z.zip, z]));
  const rows: any[] = [];
  for (const f of data.features) {
    const zip = String(f.attributes?.ZCTA5 ?? "");
    if (!/^\d{5}$/.test(zip) || have.get(zip)?.geom) continue;
    const ring = [...(f.geometry?.rings ?? [])].sort((a: number[][], b: number[][]) => ringArea(b) - ringArea(a))[0];
    if (!ring || ring.length < 4) continue;
    const pts: [number, number][] = [];
    for (const [x, y] of ring) {
      const p: [number, number] = [Math.round(y * 1000) / 1000, Math.round(x * 1000) / 1000];
      const l = pts[pts.length - 1];
      if (!l || l[0] !== p[0] || l[1] !== p[1]) pts.push(p);
    }
    const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
    rows.push({
      zip, geom: pts, bbox: [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)], source_key: "census_zcta",
      name: have.get(zip)?.name ?? SA_NAMES[zip] ?? (zip.startsWith("782") ? "San Antonio" : null),
    });
  }
  if (rows.length) {
    const { error } = await admin.from("zip_boundaries").upsert(rows, { onConflict: "zip" });
    if (error) throw new Error(error.message);
  }
  return { added: rows.length, found: data.features.length };
}

// ---------------- Radar NEXRAD (NOAA SWDI, índice de granizo) ----------------
type Det = { t: string; date: string; radar: string; cell: string; size: number; lat: number; lng: number };
const localDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(iso));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return ymd(x); };
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dy = (a.lat - b.lat) * 111.2, dx = (a.lng - b.lng) * 111.2 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
};

// Polígono que cubre el tramo entre dos detecciones (radio r km)
function capsule(a: { lat: number; lng: number }, b: { lat: number; lng: number }, rKm: number): [number, number][] {
  const pts: [number, number][] = [];
  for (const p of [a, b]) for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * 2 * Math.PI;
    pts.push([p.lat + (rKm / 111.2) * Math.sin(ang), p.lng + (rKm / (111.2 * Math.cos(p.lat * Math.PI / 180))) * Math.cos(ang)]);
  }
  // envolvente convexa (monotone chain) en (lng, lat)
  const P = pts.map(([la, lo]) => [lo, la]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: number[], a2: number[], b2: number[]) => (a2[0] - o[0]) * (b2[1] - o[1]) - (a2[1] - o[1]) * (b2[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  const ring = hull.map(([x, y]) => [Math.round(y * 1000) / 1000, Math.round(x * 1000) / 1000] as [number, number]);
  ring.push(ring[0]);
  return ring;
}

const THRESHOLDS = [1.75, 2, 2.25, 2.75];
const R_KM = 2.5;

// Importa un tramo de hasta 30 días (fechas locales de Texas) para la región.
export async function importNexrad(region: Region, from: string, to: string) {
  const [s, w, n, e] = region.bbox;
  const url = `https://www.ncei.noaa.gov/swdiws/csv/nx3hail/${from.replace(/-/g, "")}:${addDays(to, 1).replace(/-/g, "")}?bbox=${w},${s},${e},${n}`;
  const csv = await (await get(url, 40000)).text();
  let dets: Det[] = parseSwdi(csv).map((d) => ({ ...d, date: localDate(d.t) })).filter((d) => d.date >= from && d.date <= to && d.size >= 1);
  // Un radar por día para no repetir la misma tormenta: KEWX (New Braunfels) si detectó algo ese día
  const byDate = new Map<string, Det[]>();
  for (const d of dets) { if (!byDate.has(d.date)) byDate.set(d.date, []); byDate.get(d.date)!.push(d); }
  dets = [];
  byDate.forEach((list) => {
    const ewx = list.filter((d) => d.radar === "KEWX");
    const pick = ewx.length ? ewx : (() => {
      const cnt = new Map<string, number>(); list.forEach((d) => cnt.set(d.radar, (cnt.get(d.radar) ?? 0) + 1));
      const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return list.filter((d) => d.radar === best);
    })();
    dets.push(...pick);
  });

  const admin = createAdminClient();
  const { data: zipsData } = await admin.from("zip_boundaries").select("zip, geom, bbox").not("geom", "is", null);
  const zips = ((zipsData ?? []) as any[]).filter((z) => z.bbox && (z.bbox[0] + z.bbox[2]) / 2 >= s && (z.bbox[0] + z.bbox[2]) / 2 <= n && (z.bbox[1] + z.bbox[3]) / 2 >= w && (z.bbox[1] + z.bbox[3]) / 2 <= e);

  const stats: any[] = [];
  const swaths: any[] = [];
  const dates = Array.from(new Set(dets.map((d) => d.date)));
  for (const date of dates) {
    const dd = dets.filter((d) => d.date === date);
    // Franjas: tramos entre detecciones consecutivas de la misma celda
    const cells = new Map<string, Det[]>();
    for (const d of dd) { const k = `${d.radar}|${d.cell}`; if (!cells.has(k)) cells.set(k, []); cells.get(k)!.push(d); }
    cells.forEach((list, k) => {
      list.sort((a, b) => a.t.localeCompare(b.t));
      for (const thr of THRESHOLDS) {
        list.forEach((d, i) => {
          if (d.size < thr) return;
          const nx = list[i + 1];
          const link = nx && nx.size >= thr && km(d, nx) <= 15 ? nx : null;
          const prevLinked = i > 0 && list[i - 1].size >= thr && km(list[i - 1], d) <= 15;
          if (!link && prevLinked) return; // ya cubierta por el tramo anterior
          const geom = capsule(d, link ?? d, R_KM);
          const la = geom.map((p) => p[0]), lo = geom.map((p) => p[1]);
          swaths.push({ source_key: "nexrad", event_date: date, min_hail_in: thr, geom, bbox: [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)], external_id: `${date}|${k}|${thr}|${d.t}` });
        });
      }
    });
    // Estadística por ZIP: muestra en rejilla de ~1 km, distancia a la detección más cercana
    for (const z of zips) {
      const b = z.bbox;
      const near = dd.filter((d) => d.lat >= b[0] - 0.03 && d.lat <= b[2] + 0.03 && d.lng >= b[1] - 0.035 && d.lng <= b[3] + 0.035);
      if (!near.length) continue;
      let total = 0, c1 = 0, c175 = 0, c25 = 0, mx = 0;
      for (let la = b[0] + 0.005; la < b[2]; la += 0.01) for (let lo = b[1] + 0.005; lo < b[3]; lo += 0.01) {
        if (!pointInRing(la, lo, z.geom)) continue;
        total++;
        let best = 0;
        for (const d of near) if (d.size > best && km({ lat: la, lng: lo }, d) <= R_KM) best = d.size;
        if (best >= 1) c1++; if (best >= 1.75) c175++; if (best >= 2.5) c25++;
        if (best > mx) mx = best;
      }
      if (!total || mx < 1) continue;
      const r4 = (x: number) => Math.round((x / total) * 10000) / 10000;
      stats.push({ zip: z.zip, event_date: date, source_key: "nexrad", max_hail_in: Math.min(8, mx), frac_1: r4(c1), frac_175: r4(c175), frac_25: r4(c25) });
    }
  }
  for (let i = 0; i < swaths.length; i += 500) {
    const { error } = await admin.from("storm_swaths").upsert(swaths.slice(i, i + 500), { onConflict: "source_key,external_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  if (stats.length) {
    const { error } = await admin.from("zip_hail_stats").upsert(stats, { onConflict: "zip,event_date,source_key" });
    if (error) throw new Error(error.message);
  }
  return { detections: dets.length, swaths: swaths.length, stats: stats.length, days: dates.length };
}
