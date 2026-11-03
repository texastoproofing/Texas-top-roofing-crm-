import "server-only";
import { createAdminClient } from "./supabase/admin";
import { mailingIsSitus, parseSitus, streetBase, streetMatches } from "./owners";

// Registros públicos de los distritos de tasación (sin clave):
// Bexar:      https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0
// Williamson: https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0
// Travis:     https://taxmaps.traviscountytx.gov/arcgis/rest/services/Parcels/MapServer/0
const UA = "TexasTopRoofingCRM/1.0 (+https://texas-top-roofing-crm.vercel.app)";
type House = { prop_id: string; number: number | null; street: string; line: string; owner: string | null; mailing: string | null; occupied: boolean | null; year: number | null };
type Provider = { key: string; label: string; fetch: (env: string, word: string) => Promise<House[]> };

async function getJson(url: string, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j?.error) throw new Error(j.error.message ?? "error del condado");
    return j;
  } finally { clearTimeout(t); }
}
const q = (base: string, where: string, env: string, fields: string) => `${base}?${new URLSearchParams({
  where, geometry: env, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
  outFields: fields, returnGeometry: "false", resultRecordCount: "2000", f: "json",
})}`;
const esc = (s: string) => s.replace(/'/g, "''");
const clean = (...p: any[]) => p.map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ") || null;

const BEXAR: Provider = {
  key: "bexar_cad", label: "Bexar",
  async fetch(env, word) {
    const j = await getJson(q("https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query", `Situs LIKE '% ${esc(word)}%'`, env,
      "PropID,Situs,Owner,AddrLn1,AddrLn2,AddrCity,AddrSt,Zip,YrBlt,State_cd,Exempts"));
    return (j.features ?? []).map((f: any) => f.attributes).filter((a: any) => a?.Situs && a.PropID && (!a.State_cd || /^A/.test(a.State_cd))).map((a: any) => {
      const p = parseSitus(a.Situs);
      return { prop_id: String(a.PropID), number: p.number, street: p.street, line: p.line, owner: clean(a.Owner),
        mailing: clean(a.AddrLn1, a.AddrLn2, a.AddrCity && `${a.AddrCity},`, a.AddrSt, a.Zip), occupied: /\bHS\b/.test(String(a.Exempts ?? "")),
        year: Number(a.YrBlt) > 1800 ? Number(a.YrBlt) : null };
    });
  },
};
const WILLIAMSON: Provider = {
  key: "wcad", label: "Williamson",
  async fetch(env, word) {
    const j = await getJson(q("https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0/query", `SitusAddress LIKE '% ${esc(word)}%'`, env,
      "PropertyID,SitusAddress,OWNERNME1,PSTLADDRESS,PSTLCITY,PSTLSTATE,PSTLZIP5,ExemptionList,RESYRBLT,PropertyTypeCode"));
    return (j.features ?? []).map((f: any) => f.attributes).filter((a: any) => a?.SitusAddress && a.PropertyID && a.PropertyTypeCode === "RES").map((a: any) => {
      const p = parseSitus(a.SitusAddress);
      return { prop_id: String(a.PropertyID), number: p.number, street: p.street, line: p.line, owner: clean(a.OWNERNME1),
        mailing: clean(a.PSTLADDRESS, a.PSTLCITY && `${a.PSTLCITY},`, a.PSTLSTATE, a.PSTLZIP5), occupied: /\bHS\b/.test(String(a.ExemptionList ?? "")),
        year: Number(a.RESYRBLT) > 1800 ? Number(a.RESYRBLT) : null };
    });
  },
};
const TRAVIS: Provider = {
  key: "tcad", label: "Travis",
  async fetch(env, word) {
    const j = await getJson(q("https://taxmaps.traviscountytx.gov/arcgis/rest/services/Parcels/MapServer/0/query", `situs_address LIKE '% ${esc(word)}%'`, env,
      "PROP_ID,situs_address,py_owner_name,py_address,land_state_cd,F1year_imprv"));
    return (j.features ?? []).map((f: any) => f.attributes).filter((a: any) => a?.situs_address && a.PROP_ID && /^A/.test(String(a.land_state_cd ?? ""))).map((a: any) => {
      const p = parseSitus(a.situs_address);
      const mailing = clean(a.py_address);
      // Travis no publica la exención homestead en este servicio: se compara la dirección postal con la casa
      return { prop_id: String(a.PROP_ID), number: p.number, street: p.street, line: p.line, owner: clean(a.py_owner_name),
        mailing, occupied: mailingIsSitus(mailing, p.number), year: Number(a.F1year_imprv) > 1800 ? Number(a.F1year_imprv) : null };
    });
  },
};
const providersFor = (code: string) => (code.startsWith("S") ? [BEXAR] : [WILLIAMSON, TRAVIS]);

// Carga las casas de las calles de una zona (máx. `limit` calles por llamada). Devuelve cuántas faltan.
export async function importOwnersForTerritory(territoryId: string, limit = 10) {
  const admin = createAdminClient();
  const { data: terr } = await admin.from("territories").select("code").eq("id", territoryId).maybeSingle();
  if (!terr) throw new Error("Zona no encontrada.");
  const providers = providersFor(String(terr.code));
  const { data: streets } = await admin.from("territory_streets").select("id, name, geom, geom_status")
    .eq("territory_id", territoryId).is("owners_loaded_at", null).order("position").limit(limit);
  let houses = 0;
  const notes: string[] = [];
  for (const s of (streets ?? []) as any[]) {
    const lines: [number, number][][] = s.geom_status === "ok" && Array.isArray(s.geom) ? s.geom : [];
    if (!lines.length) {
      await admin.from("territory_streets").update({ owners_loaded_at: new Date().toISOString(), owners_status: "sin_trazo" }).eq("id", s.id);
      continue;
    }
    const pts = lines.flat();
    const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
    const pad = 0.0015;
    const env = `${Math.min(...lo) - pad},${Math.min(...la) - pad},${Math.max(...lo) + pad},${Math.max(...la) + pad}`;
    const word = streetBase(s.name).split(" ")[0];
    const found = new Map<string, House & { source: string }>();
    let failed = false;
    for (const pr of providers) {
      try {
        // Casas en la línea entre condados aparecen en ambos registros: se queda la primera fuente (Williamson antes que Travis)
        const seen = new Set([...found.values()].map((x) => x.number));
        for (const h of await pr.fetch(env, word)) if (streetMatches(h.street, s.name) && !(h.number != null && seen.has(h.number))) found.set(`${pr.key}|${h.prop_id}`, { ...h, source: pr.key });
      } catch { notes.push(`${s.name}: ${pr.label} no respondió`); failed = true; }
    }
    if (failed) break;
    const rows = [...found.values()].map((h) => ({
      street_id: s.id, source: h.source, prop_id: h.prop_id, house_number: h.number, situs: h.line, owner_name: h.owner,
      owner_mailing: h.mailing, owner_occupied: h.occupied, year_built: h.year, updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await admin.from("street_houses").upsert(rows, { onConflict: "source,prop_id" });
      if (error) { notes.push(`${s.name}: ${error.message}`); break; }
    }
    houses += rows.length;
    await admin.from("territory_streets").update({ owners_loaded_at: new Date().toISOString(), owners_status: rows.length ? "ok" : "sin_casas" }).eq("id", s.id);
  }
  const { count } = await admin.from("territory_streets").select("id", { count: "exact", head: true }).eq("territory_id", territoryId).is("owners_loaded_at", null);
  return { houses, remaining: count ?? 0, notes };
}
