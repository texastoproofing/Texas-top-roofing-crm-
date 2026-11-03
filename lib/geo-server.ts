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

// Servidores públicos de Overpass; si uno está ocupado (429/504) se prueba el siguiente
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const esc = (s: string) => s.replace(/[\\"]/g, "\\$&").replace(/[.*+?^${}()|[\]]/g, "\\\\$&");

async function overpass(query: string) {
  let last: unknown;
  for (const url of OVERPASS) {
    try {
      return await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      }, 20000);
    } catch (e) {
      last = e;
    }
  }
  throw last;
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

// ---------------------------------------------------------------------
// Trazo de UNA calle con Nominatim (OpenStreetMap). Política de uso:
// máximo 1 consulta por segundo, identificarse y guardar resultados (lo hacemos).
// https://operations.osmfoundation.org/policies/nominatim/
// ---------------------------------------------------------------------
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

function linesFromGeojson(g: any): [number, number][][] {
  const toLL = (c: any[]) => c.map((p) => [Number(p[1]), Number(p[0])] as [number, number])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (g?.type === "LineString") return [toLL(g.coordinates)].filter((l) => l.length > 1);
  if (g?.type === "MultiLineString") return g.coordinates.map(toLL).filter((l: any[]) => l.length > 1);
  return [];
}

export async function fetchStreetNominatim(name: string, city: string | null, zip: string | null):
  Promise<{ status: "ok"; lines: [number, number][][] } | { status: "no_encontrada" } | { status: "error"; error: string }> {
  const tries: Record<string, string>[] = [];
  if (city) tries.push({ city });
  if (zip) tries.push({ postalcode: zip });
  for (let i = 0; i < tries.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100));
    const u = new URL(NOMINATIM);
    u.searchParams.set("street", name);
    Object.entries(tries[i]).forEach(([k, v]) => u.searchParams.set(k, v));
    u.searchParams.set("state", "Texas");
    u.searchParams.set("countrycodes", "us");
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("polygon_geojson", "1");
    u.searchParams.set("limit", "20");
    u.searchParams.set("dedupe", "0");
    let data: any[];
    try {
      data = await fetchJson(u.toString(), { headers: { "Accept-Language": "en" } }, 10000);
    } catch (e) {
      return { status: "error", error: (e as Error).name === "AbortError" ? "OpenStreetMap tardó demasiado." : "OpenStreetMap no respondió." };
    }
    const want = name.toLowerCase();
    const lines = (Array.isArray(data) ? data : [])
      .filter((r) => r.category === "highway" && String(r.name ?? "").toLowerCase() === want)
      .flatMap((r) => linesFromGeojson(r.geojson));
    if (lines.length) return { status: "ok", lines };
  }
  return { status: "no_encontrada" };
}
