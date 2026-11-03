import "server-only";

// ---------------------------------------------------------------------
// Geocodificación con el US Census Geocoder (gratis, sin clave, solo EE. UU.)
// https://geocoding.geo.census.gov/geocoder/
// ---------------------------------------------------------------------
export type GeoCandidate = { label: string; lat: number; lng: number; zip?: string };
export type GeoResult =
  | { status: "ok"; lat: number; lng: number; matched: string; candidates?: undefined }
  | { status: "ambigua"; candidates: GeoCandidate[] }
  | { status: "sin_resultado" }
  | { status: "error"; error: string };

const UA = "TexasTopRoofingCRM/1.0 (texastoproofingaustin@gmail.com)";

async function fetchJson(url: string, init: RequestInit = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...(init.headers ?? {}) }, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function geocodeAddress(input: string): Promise<GeoResult> {
  const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  u.searchParams.set("address", input);
  u.searchParams.set("benchmark", "Public_AR_Current");
  u.searchParams.set("format", "json");
  let data: any;
  try {
    data = await fetchJson(u.toString());
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "El servicio de ubicación tardó demasiado." : "El servicio de ubicación no respondió.";
    return { status: "error", error: msg };
  }
  const matches: any[] = data?.result?.addressMatches ?? [];
  const cands: GeoCandidate[] = matches
    .map((m) => ({
      label: String(m.matchedAddress ?? ""),
      lat: Number(m.coordinates?.y),
      lng: Number(m.coordinates?.x),
      zip: m.addressComponents?.zip ? String(m.addressComponents.zip) : undefined,
    }))
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180);

  if (!cands.length) return { status: "sin_resultado" };

  // Si el usuario dio ZIP, solo se aceptan resultados con ese ZIP
  const zipIn = input.match(/\b(\d{5})\b(?!.*\b\d{5}\b)/)?.[1];
  const sameZip = zipIn ? cands.filter((c) => !c.zip || c.zip === zipIn) : cands;
  if (zipIn && !sameZip.length) return { status: "ambigua", candidates: cands.slice(0, 5) };

  // Varios resultados distintos (más de ~50 m entre sí) = ambigua
  const first = sameZip[0];
  const distinct = sameZip.filter((c) => Math.abs(c.lat - first.lat) > 0.0005 || Math.abs(c.lng - first.lng) > 0.0005);
  if (distinct.length) return { status: "ambigua", candidates: sameZip.slice(0, 5) };

  return { status: "ok", lat: first.lat, lng: first.lng, matched: first.label };
}

// ---------------------------------------------------------------------
// Trazos de calles desde OpenStreetMap (Overpass API, gratis, sin clave)
// ---------------------------------------------------------------------
type Lines = [number, number][][];

const OVERPASS = "https://overpass-api.de/api/interpreter";
const esc = (s: string) => s.replace(/[\\"]/g, "\\$&").replace(/[.*+?^${}()|[\]]/g, "\\\\$&");

async function overpass(query: string) {
  return fetchJson(OVERPASS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  }, 30000);
}

function collect(data: any, names: string[]) {
  const byName = new Map<string, Lines>();
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  for (const el of data?.elements ?? []) {
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const key = wanted.get(String(el.tags?.name ?? "").toLowerCase());
    if (!key) continue;
    const line = el.geometry
      .map((p: any) => [Number(p.lat), Number(p.lon)] as [number, number])
      .filter((p: [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (line.length < 2) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(line);
  }
  return byName;
}

// Busca las calles por nombre dentro de la ciudad (Texas). Las que no aparecen dentro
// de los límites de la ciudad se buscan cerca de las ya encontradas.
export async function fetchStreetLines(city: string, names: string[]): Promise<{ found: Map<string, Lines>; error?: string }> {
  if (!names.length) return { found: new Map() };
  const rx = `^(${names.map(esc).join("|")})$`;
  try {
    const q1 = `[out:json][timeout:25];
area["ISO3166-2"="US-TX"]["admin_level"="4"]->.tx;
rel(area.tx)["boundary"="administrative"]["admin_level"="8"]["name"="${esc(city)}"];
map_to_area->.c;
way(area.c)["highway"]["name"~"${rx}",i];
out geom;`;
    const found = collect(await overpass(q1), names);
    const missing = names.filter((n) => !found.has(n));
    if (missing.length && found.size) {
      let s = 90, w = 180, n = -90, e = -180;
      found.forEach((lines) => lines.forEach((l) => l.forEach(([la, lo]) => {
        s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo);
      })));
      const pad = 0.03;
      const rx2 = `^(${missing.map(esc).join("|")})$`;
      const q2 = `[out:json][timeout:25];way["highway"]["name"~"${rx2}",i](${s - pad},${w - pad},${n + pad},${e + pad});out geom;`;
      collect(await overpass(q2), missing).forEach((v, k) => found.set(k, v));
    }
    return { found };
  } catch (e) {
    return { found: new Map(), error: (e as Error).name === "AbortError" ? "OpenStreetMap tardó demasiado." : "OpenStreetMap no respondió." };
  }
}
