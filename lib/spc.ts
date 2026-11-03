// Lector de los CSV de reportes de NOAA/SPC (sin dependencias de servidor, se puede probar aparte).
const TZ = "America/Chicago";

export type Parsed = {
  external_id: string; event_type: "granizo" | "viento"; observed_at: string; event_date: string;
  lat: number; lng: number; hail_in: number | null; wind_mph: number | null;
  location_text: string; county: string; comments: string | null;
};

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
const localDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

export function parseSpc(csv: string, day: string, type: "granizo" | "viento", bbox: number[]): Parsed[] {
  const out: Parsed[] = [];
  const lines = csv.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || /^Time,/i.test(line)) continue;
    const f = line.split(",");
    if (f.length < 7) continue;
    const [time, mag, loc, county, state, latS, lonS] = f;
    if ((state ?? "").trim() !== "TX") continue;
    const lat = Number(latS), lng = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < bbox[0] || lat > bbox[2] || lng < bbox[1] || lng > bbox[3]) continue;
    const hhmm = (time ?? "").trim().padStart(4, "0");
    if (!/^\d{4}$/.test(hhmm)) continue;
    const base = new Date(day + "T00:00:00Z");
    if (Number(hhmm) < 1200) base.setUTCDate(base.getUTCDate() + 1);
    const observed = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), Number(hhmm.slice(0, 2)), Number(hhmm.slice(2))));
    const iso = observed.toISOString();
    let hail: number | null = null, wind: number | null = null;
    if (type === "granizo") {
      const n = Number(mag);
      if (!Number.isFinite(n) || n <= 0) continue;
      hail = Math.round(n) / 100; // centésimas → pulgadas
    } else {
      const n = Number(mag);
      wind = Number.isFinite(n) && n > 0 ? Math.round(n) : null; // "UNK" = daño por viento sin velocidad medida
    }
    out.push({
      external_id: `${type}|${iso}|${lat.toFixed(3)}|${lng.toFixed(3)}`,
      event_type: type, observed_at: iso, event_date: localDate(iso), lat, lng,
      hail_in: hail, wind_mph: wind, location_text: (loc ?? "").trim(), county: (county ?? "").trim(),
      comments: f.slice(7).join(",").trim() || null,
    });
  }
  return out;
}

