import "server-only";
import { createAdminClient } from "./supabase/admin";
import { parseSitus, streetBase, streetMatches } from "./owners";

// Distrito de tasación de Bexar (registro público): https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0
const BEXAR = "https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query";
const UA = "TexasTopRoofingCRM/1.0 (+https://texas-top-roofing-crm.vercel.app)";

async function getJson(url: string, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// Carga las casas de las calles de una zona (máx. `limit` calles por llamada). Devuelve cuántas faltan.
export async function importOwnersForTerritory(territoryId: string, limit = 12) {
  const admin = createAdminClient();
  const { data: streets } = await admin.from("territory_streets").select("id, name, geom, geom_status, owners_status")
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
    const base = streetBase(s.name);
    const q = new URLSearchParams({
      where: `Situs LIKE '% ${base.replace(/'/g, "''")}%'`, geometry: env, geometryType: "esriGeometryEnvelope", inSR: "4326",
      spatialRel: "esriSpatialRelIntersects", outFields: "PropID,Situs,Owner,AddrLn1,AddrLn2,AddrCity,AddrSt,Zip,YrBlt,State_cd,Exempts",
      returnGeometry: "false", resultRecordCount: "1000", f: "json",
    });
    let data: any;
    try { data = await getJson(`${BEXAR}?${q}`); } catch (e) { notes.push(`${s.name}: el condado no respondió`); break; }
    if (data?.error) { notes.push(`${s.name}: ${data.error.message ?? "error del condado"}`); break; }
    const rows = ((data?.features ?? []) as any[]).map((f) => f.attributes).filter((a) => {
      if (!a?.Situs || !a?.PropID) return false;
      if (a.State_cd && !/^A/.test(String(a.State_cd))) return false; // solo residencial unifamiliar / móvil
      return streetMatches(parseSitus(a.Situs).street, base);
    }).map((a) => {
      const p = parseSitus(a.Situs);
      const mail = [a.AddrLn1, a.AddrLn2, [a.AddrCity, a.AddrSt].filter(Boolean).join(", "), a.Zip].map((x: any) => String(x ?? "").trim()).filter(Boolean).join(" ");
      return {
        street_id: s.id, source: "bexar_cad", prop_id: String(a.PropID), house_number: p.number, situs: p.line,
        owner_name: a.Owner ? String(a.Owner).trim() : null, owner_mailing: mail || null,
        owner_occupied: /\bHS\b/.test(String(a.Exempts ?? "")), // exención homestead = vive ahí
        year_built: Number(a.YrBlt) > 1800 ? Number(a.YrBlt) : null, updated_at: new Date().toISOString(),
      };
    });
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
