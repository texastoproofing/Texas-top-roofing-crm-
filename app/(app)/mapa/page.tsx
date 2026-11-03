import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { statusInfo } from "@/lib/constants";
import { addressInput, mapGroupOf, normInput, type MapGroup } from "@/lib/map";
import { apptLabel } from "@/lib/constants";
import { todayTX } from "@/lib/format";
import { MapApp, type MapPoint, type MapStreet } from "@/components/map/MapApp";
import { getRoute } from "./actions";

export const dynamic = "force-dynamic";
// Las acciones de esta página consultan servicios externos (Census, OpenStreetMap)
export const maxDuration = 60;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function MapaPage() {
  const { supabase, profile } = await getSession();
  const nowIso = new Date().toISOString();

  const [jobsRes, apptRes, taskRes, visitRes, terrRes, streetRes, streetVisitRes, users, route] = await Promise.all([
    supabase.from("jobs")
      .select("id, number, name, status, address, city, zip, sales_rep_id, territory_id, reference_authorized, contact:contacts(first_name, last_name, address, city, zip, state), rep:profiles!jobs_sales_rep_id_fkey(full_name), location:job_locations(input, status, lat, lng, matched_address, source, candidates, error)")
      .limit(2000),
    supabase.from("appointments").select("job_id, title, kind, starts_at").gte("starts_at", nowIso).not("job_id", "is", null).order("starts_at").limit(2000),
    supabase.from("tasks").select("job_id, title, due_at").eq("done", false).not("job_id", "is", null).order("due_at", { ascending: true, nullsFirst: false }).limit(2000),
    supabase.from("activities").select("job_id, created_at").eq("kind", "visita").not("job_id", "is", null).order("created_at", { ascending: false }).limit(5000),
    supabase.from("territories").select("id, code, name, city, zip").order("priority"),
    supabase.from("territory_streets").select("id, name, territory_id, status, geom, geom_status, last_visit_at, doors_knocked, leads, visitor:profiles(full_name)").order("position"),
    supabase.from("street_visits").select("street_id, visited_on").order("visited_on", { ascending: false }).limit(5000),
    listProfiles(),
    getRoute(todayTX()),
  ]);

  // Próxima actividad por trabajo: la cita futura más cercana o, si no hay, la tarea pendiente más próxima
  const nextAct = new Map<string, { when: string | null; label: string }>();
  for (const a of apptRes.data ?? []) {
    if (!nextAct.has(a.job_id)) nextAct.set(a.job_id, { when: a.starts_at, label: `${apptLabel(a.kind)}: ${a.title}` });
  }
  for (const t of taskRes.data ?? []) {
    if (!nextAct.has(t.job_id)) nextAct.set(t.job_id, { when: t.due_at, label: `Tarea: ${t.title}` });
  }
  const lastVisit = new Map<string, string>();
  for (const v of visitRes.data ?? []) if (!lastVisit.has(v.job_id)) lastVisit.set(v.job_id, v.created_at);

  let pendingGeocode = 0;
  const points: MapPoint[] = (jobsRes.data ?? []).map((j: any) => {
    const c = one<any>(j.contact);
    const loc = one<any>(j.location);
    const addr = { address: j.address ?? c?.address, city: j.city ?? c?.city, zip: j.zip ?? c?.zip, state: c?.state };
    const input = addressInput(addr);
    const fresh = !!(loc && input && loc.input === normInput(input)) || loc?.source === "manual";
    if (input && !fresh) pendingGeocode++;
    const okLoc = fresh && loc.status === "ok";
    const group: MapGroup = mapGroupOf(j.status);
    return {
      id: j.id,
      number: j.number,
      name: j.name,
      customer: [c?.first_name, c?.last_name].filter(Boolean).join(" ") || j.name,
      address: [addr.address, addr.city, addr.zip].filter(Boolean).join(", "),
      zip: addr.zip ?? null,
      status: j.status,
      statusLabel: statusInfo(j.status).label,
      group,
      repId: j.sales_rep_id,
      repName: one<any>(j.rep)?.full_name ?? null,
      territoryId: j.territory_id,
      lat: okLoc ? loc.lat : null,
      lng: okLoc ? loc.lng : null,
      locStatus: !input ? "sin_direccion" : !fresh ? "pendiente" : loc.status,
      locSource: fresh ? loc.source : null,
      matched: fresh ? loc.matched_address : null,
      candidates: fresh && loc.status === "ambigua" ? (loc.candidates ?? []) : [],
      locError: fresh ? loc.error : null,
      nextActivity: nextAct.get(j.id) ?? null,
      lastVisit: lastVisit.get(j.id) ?? null,
      referenceAuthorized: !!j.reference_authorized,
    };
  });

  const territoryCode = new Map((terrRes.data ?? []).map((t) => [t.id, t.code]));
  const lastStreetVisit = new Map<string, string>();
  const visitCount = new Map<string, number>();
  for (const v of streetVisitRes.data ?? []) {
    if (!lastStreetVisit.has(v.street_id)) lastStreetVisit.set(v.street_id, v.visited_on);
    visitCount.set(v.street_id, (visitCount.get(v.street_id) ?? 0) + 1);
  }
  const streets: MapStreet[] = (streetRes.data ?? []).map((s: any) => {
    const sv = lastStreetVisit.get(s.id);
    const lv = s.last_visit_at ? new Date(s.last_visit_at).toISOString().slice(0, 10) : null;
    return {
      id: s.id, name: s.name, territoryId: s.territory_id, territoryCode: territoryCode.get(s.territory_id) ?? "",
      status: s.status, lines: s.geom_status === "ok" && Array.isArray(s.geom) ? s.geom : [], geomStatus: s.geom_status,
      lastVisit: [sv, lv].filter(Boolean).sort().reverse()[0] ?? null,
      lastVisitBy: one<any>(s.visitor)?.full_name ?? null,
      doors: s.doors_knocked ?? 0, leads: s.leads ?? 0, visits: visitCount.get(s.id) ?? 0,
    };
  });
  const territoriesPendingGeom = Array.from(new Set(
    streets.filter((s) => s.geomStatus === "pendiente" || s.geomStatus === "error").map((s) => s.territoryId),
  ));

  return (
    <MapApp
      me={profile.id}
      staff={isStaff(profile)}
      points={points}
      streets={streets}
      territories={terrRes.data ?? []}
      users={users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.full_name }))}
      pendingGeocode={pendingGeocode}
      territoriesPendingGeom={territoriesPendingGeom}
      initialRoute={route.ok ? route.route : null}
      today={todayTX()}
      tileUrl={process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
      tileAttribution={process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
    />
  );
}
