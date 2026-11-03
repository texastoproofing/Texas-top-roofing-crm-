// Lector del CSV de NOAA SWDI (nx3hail). Sin dependencias para poder probarlo.
type Det = { t: string; radar: string; cell: string; size: number; lat: number; lng: number };
export function parseSwdi(csv: string): Det[] {
  const out: Det[] = [];
  const lines = csv.split(/\r?\n/);
  const h = (lines[0] ?? "").split(",");
  const ix = (k: string) => h.indexOf(k);
  const [it, ir, ic, is, ila, ilo] = ["ZTIME", "WSR_ID", "CELL_ID", "MAXSIZE", "LAT", "LON"].map(ix);
  if ([it, ir, ic, is, ila, ilo].some((i) => i < 0)) return out;
  for (const l of lines.slice(1)) {
    if (!l || l.startsWith("summary")) break;
    const c = l.split(",");
    const size = Number(c[is]), lat = Number(c[ila]), lng = Number(c[ilo]);
    if (!Number.isFinite(size) || !Number.isFinite(lat) || !Number.isFinite(lng) || !c[it]) continue;
    out.push({ t: c[it], radar: c[ir], cell: c[ic], size, lat, lng });
  }
  return out;
}

