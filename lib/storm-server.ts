import "server-only";
import { createAdminClient } from "./supabase/admin";
import { pointInRing, type ZipInfo } from "./storm";
import { distanceM } from "./map";
import { parseSpc, ymd, type Parsed } from "./spc";

// ---------------------------------------------------------------------
// NOAA Storm Prediction Center – reportes locales de tormenta (preliminares)
// https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_filtered_hail.csv
//   Hail: Time,Size,Location,County,State,Lat,Lon,Comments   (Size en centésimas de pulgada; Time HHMM UTC)
//   Wind: Time,Speed,Location,County,State,Lat,Lon,Comments  (Speed en mph o "UNK")
// El "día SPC" va de 12Z a 12Z: un reporte con hora < 1200 pertenece al día UTC siguiente.
// ---------------------------------------------------------------------
const SPC = "https://www.spc.noaa.gov/climo/reports/";
const UA = "TexasTopRoofingCRM/1.0 (texastoproofingaustin@gmail.com)";

async function fetchText(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: ctrl.signal });
    if (r.status === 404) return "";
    if (!r.ok) throw new Error(`SPC respondió ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

async function loadZips(admin: any): Promise<ZipInfo[]> {
  const { data } = await admin.from("zip_boundaries").select("zip, name, geom, bbox");
  return (data ?? []) as ZipInfo[];
}

function zipFor(lat: number, lng: number, zips: ZipInfo[]) {
  for (const z of zips) {
    const b = z.bbox;
    if (z.geom && b && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3] && pointInRing(lat, lng, z.geom)) return z.zip;
  }
  return null;
}

// Importa reportes SPC de un rango de días (fechas SPC). Devuelve conteos.
export async function syncSpcRange(from: string, to: string, opts: { alerts: boolean; startedBy: string | null }) {
  const admin = createAdminClient();
  const { data: settings } = await admin.from("storm_settings").select("*").eq("id", 1).single();
  const bbox: number[] = settings?.sync_bbox ?? [29.2, -98.9, 31.4, -96.9];
  const { data: job } = await admin.from("storm_sync_jobs")
    .insert({ source_key: "spc", range_start: from, range_end: to, status: "en_curso", started_by: opts.startedBy })
    .select("id").single();

  const days: string[] = [];
  for (let d = new Date(from + "T00:00:00Z"); ymd(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) days.push(ymd(d).slice(2).replace(/-/g, "") + "|" + ymd(d));

  const zips = await loadZips(admin);
  let parsed: Parsed[] = [];
  const errors: string[] = [];
  for (let i = 0; i < days.length; i += 6) {
    const chunk = days.slice(i, i + 6);
    const res = await Promise.all(chunk.flatMap((k) => {
      const [code, day] = k.split("|");
      return (["granizo", "viento"] as const).map(async (type) => {
        try {
          const csv = await fetchText(`${SPC}${code}_rpts_filtered_${type === "granizo" ? "hail" : "wind"}.csv`);
          return parseSpc(csv, day, type, bbox);
        } catch (e) {
          errors.push(`${day} ${type}: ${(e as Error).message}`);
          return [];
        }
      });
    }));
    parsed = parsed.concat(res.flat());
  }

  let inserted: any[] = [];
  if (parsed.length) {
    const rows = parsed.map((p) => ({ ...p, source_key: "spc", zip: zipFor(p.lat, p.lng, zips), data_quality: p.event_type === "granizo" ? "reportado" : "reportado" }));
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await admin.from("storm_events")
        .upsert(rows.slice(i, i + 500), { onConflict: "source_key,external_id", ignoreDuplicates: true })
        .select("id, event_type, event_date, lat, lng, hail_in, wind_mph, location_text, zip");
      if (error) errors.push(error.message);
      inserted = inserted.concat(data ?? []);
    }
  }

  let alertsCreated = 0;
  if (opts.alerts && inserted.length) {
    const minHail = Number(settings?.alert_min_hail_in ?? 1);
    const minWind = Number(settings?.alert_min_wind_mph ?? 58);
    const relevant = inserted.filter((e) => (e.event_type === "granizo" && Number(e.hail_in) >= minHail) || (e.event_type === "viento" && (e.wind_mph ?? 0) >= minWind));
    if (relevant.length) {
      const { data: locs } = await admin.from("job_locations").select("lat, lng").eq("status", "ok");
      const alerts = relevant.map((e) => {
        const near = (locs ?? []).filter((l: any) => distanceM({ lat: l.lat, lng: l.lng }, e) <= 4828).length;
        const zipsNear = new Set<string>();
        if (e.zip) zipsNear.add(e.zip);
        for (const z of zips) { // ZIPs a menos de ~3 millas del reporte (por su caja)
          const b = z.bbox; if (!b) continue;
          if (e.lat >= b[0] - 0.045 && e.lat <= b[2] + 0.045 && e.lng >= b[1] - 0.05 && e.lng <= b[3] + 0.05) zipsNear.add(z.zip);
        }
        const what = e.event_type === "granizo" ? `Granizo ${Number(e.hail_in).toFixed(2)}"` : `Viento ${e.wind_mph ?? "sin velocidad"} mph`;
        return { event_id: e.id, title: `${what} · ${e.location_text} · ${e.event_date}`, zips: [...zipsNear].slice(0, 12), leads_nearby: near, is_realtime: false };
      });
      const { data } = await admin.from("storm_alerts").upsert(alerts, { onConflict: "event_id", ignoreDuplicates: true }).select("id");
      alertsCreated = (data ?? []).length;
    }
  }

  const status = errors.length ? (inserted.length || parsed.length ? "parcial" : "error") : "ok";
  if (job) {
    await admin.from("storm_sync_jobs").update({
      status, inserted: inserted.length, skipped: parsed.length - inserted.length,
      error: errors.length ? errors.slice(0, 5).join(" | ") : null, finished_at: new Date().toISOString(),
    }).eq("id", job.id);
  }
  return { status, found: parsed.length, inserted: inserted.length, alerts: alertsCreated, errors };
}
