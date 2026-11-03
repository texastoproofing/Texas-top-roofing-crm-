"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { fetchStreetNominatim, geocodeAddress, type GeoCandidate } from "@/lib/geo-server";
import { addressInput, isLatLng, normInput } from "@/lib/map";
import { isUuid } from "@/lib/files";
import { todayTX } from "@/lib/format";

type R<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------
// Geocodificación de trabajos (solo los que el usuario puede ver; RLS)
// ---------------------------------------------------------------------
async function geocodeOne(supabase: any, jobId: string, input: string) {
  const g = await geocodeAddress(input);
  const row: Record<string, unknown> = {
    job_id: jobId, input: normInput(input), updated_at: new Date().toISOString(),
    lat: null, lng: null, matched_address: null, candidates: null, error: null, source: "census",
  };
  if (g.status === "ok") Object.assign(row, { status: "ok", lat: g.lat, lng: g.lng, matched_address: g.matched });
  else if (g.status === "ambigua") Object.assign(row, { status: "ambigua", candidates: g.candidates });
  else if (g.status === "sin_resultado") Object.assign(row, { status: "sin_resultado" });
  else Object.assign(row, { status: "error", error: g.error });
  const { error } = await supabase.from("job_locations").upsert(row);
  if (error) throw new Error(error.message);
  return g.status;
}

export async function geocodePending(limit = 12): Promise<R<{ processed: number; remaining: number; failed: number }>> {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("jobs")
    .select("id, address, city, zip, contact:contacts(address, city, zip, state), location:job_locations(input, status, updated_at)")
    .limit(2000);
  if (error) return { ok: false, error: "No se pudieron leer los trabajos." };

  const retryAfter = Date.now() - 6 * 3600 * 1000; // errores del proveedor se reintentan cada 6 h
  const todo: { id: string; input: string }[] = [];
  for (const j of (data ?? []) as any[]) {
    const loc = Array.isArray(j.location) ? j.location[0] : j.location;
    const input = addressInput({ address: j.address ?? j.contact?.address, city: j.city ?? j.contact?.city, zip: j.zip ?? j.contact?.zip, state: j.contact?.state });
    if (!input) continue;
    const same = loc && loc.input === normInput(input);
    if (same && loc.status !== "error") continue; // reutiliza la ubicación guardada
    if (same && loc.status === "error" && new Date(loc.updated_at).getTime() > retryAfter) continue;
    todo.push({ id: j.id, input });
  }

  const batch = todo.slice(0, limit);
  let failed = 0;
  for (let i = 0; i < batch.length; i += 4) {
    const res = await Promise.all(batch.slice(i, i + 4).map((t) => geocodeOne(supabase, t.id, t.input).catch(() => "error")));
    failed += res.filter((s) => s === "error").length;
  }
  if (batch.length) revalidatePath("/mapa");
  return { ok: true, processed: batch.length, remaining: todo.length - batch.length, failed };
}

export async function retryGeocode(jobId: string): Promise<R<{ status: string }>> {
  const { supabase } = await getSession();
  if (!isUuid(jobId)) return { ok: false, error: "Trabajo no válido." };
  const { data: j } = await supabase.from("jobs")
    .select("id, address, city, zip, contact:contacts(address, city, zip, state)").eq("id", jobId).maybeSingle();
  if (!j) return { ok: false, error: "No tienes acceso a este trabajo." };
  const c: any = Array.isArray(j.contact) ? j.contact[0] : j.contact;
  const input = addressInput({ address: j.address ?? c?.address, city: j.city ?? c?.city, zip: j.zip ?? c?.zip, state: c?.state });
  if (!input) return { ok: false, error: "Falta la dirección completa (número, calle y ciudad o ZIP). Corrígela en el trabajo." };
  try {
    const status = await geocodeOne(supabase, jobId, input);
    revalidatePath("/mapa");
    return { ok: true, status };
  } catch {
    return { ok: false, error: "No se pudo guardar la ubicación." };
  }
}

export async function chooseCandidate(jobId: string, index: number): Promise<R> {
  const { supabase } = await getSession();
  if (!isUuid(jobId)) return { ok: false, error: "Trabajo no válido." };
  const { data: loc } = await supabase.from("job_locations").select("candidates").eq("job_id", jobId).maybeSingle();
  const cand: GeoCandidate | undefined = (loc?.candidates ?? [])[index];
  if (!cand || !isLatLng(cand)) return { ok: false, error: "Esa opción ya no existe. Recarga." };
  const { error } = await supabase.from("job_locations").update({
    status: "ok", lat: cand.lat, lng: cand.lng, matched_address: cand.label, source: "census-elegida",
    candidates: null, error: null, updated_at: new Date().toISOString(),
  }).eq("job_id", jobId);
  if (error) return { ok: false, error: "No se pudo guardar." };
  revalidatePath("/mapa");
  return { ok: true };
}

// El usuario toca el punto exacto en el mapa (coordenadas reales elegidas por una persona)
export async function setManualLocation(jobId: string, lat: number, lng: number): Promise<R> {
  const { supabase } = await getSession();
  if (!isUuid(jobId) || !isLatLng({ lat, lng })) return { ok: false, error: "Ubicación no válida." };
  const { data: j } = await supabase.from("jobs")
    .select("id, address, city, zip, contact:contacts(address, city, zip, state)").eq("id", jobId).maybeSingle();
  if (!j) return { ok: false, error: "No tienes acceso a este trabajo." };
  const c: any = Array.isArray(j.contact) ? j.contact[0] : j.contact;
  const input = addressInput({ address: j.address ?? c?.address, city: j.city ?? c?.city, zip: j.zip ?? c?.zip, state: c?.state })
    ?? `manual:${jobId}`;
  const { error } = await supabase.from("job_locations").upsert({
    job_id: jobId, input: normInput(input), status: "ok", lat, lng, source: "manual",
    matched_address: "Ubicación marcada a mano en el mapa", candidates: null, error: null, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "No se pudo guardar la ubicación." };
  revalidatePath("/mapa");
  return { ok: true };
}

// Dirección de salida manual para la ruta
export async function geocodeStart(address: string): Promise<R<{ lat: number; lng: number; label: string; candidates?: GeoCandidate[] }>> {
  await getSession();
  const a = (address ?? "").trim();
  if (a.length < 6 || !/\d/.test(a)) return { ok: false, error: "Escribe una dirección completa con número, calle y ciudad o ZIP." };
  const g = await geocodeAddress(/tx|texas/i.test(a) ? a : `${a}, TX`);
  if (g.status === "ok") return { ok: true, lat: g.lat, lng: g.lng, label: g.matched };
  if (g.status === "ambigua") return { ok: false, error: "La dirección coincide con varios lugares. Agrega la ciudad o el ZIP." };
  if (g.status === "sin_resultado") return { ok: false, error: "No se encontró esa dirección. Revisa el número y la calle." };
  return { ok: false, error: g.error };
}

// ---------------------------------------------------------------------
// Trazos de calles (OpenStreetMap), se guardan una sola vez
// ---------------------------------------------------------------------
export async function loadStreetGeometry(territoryId: string): Promise<R<{ found: number; missing: number; remaining: number }>> {
  const { supabase } = await getSession();
  if (!isUuid(territoryId)) return { ok: false, error: "Zona no válida." };
  const { data: t } = await supabase.from("territories").select("id, city, zip").eq("id", territoryId).maybeSingle();
  if (!t) return { ok: false, error: "Zona no encontrada." };
  const { data: streets } = await supabase.from("territory_streets")
    .select("id, name, geom_status, geom_updated_at").eq("territory_id", territoryId).order("position");
  const retryAfter = Date.now() - 15 * 60 * 1000; // si OpenStreetMap falló, se reintenta a los 15 min
  const pending = (streets ?? []).filter((s) => s.geom_status === "pendiente"
    || (s.geom_status === "error" && (!s.geom_updated_at || new Date(s.geom_updated_at).getTime() < retryAfter)));
  if (!pending.length) return { ok: true, found: 0, missing: 0, remaining: 0 };

  // Máximo ~1 consulta por segundo (política de Nominatim) y un lote que quepa en el tiempo de la función
  const batch = pending.slice(0, 18);
  let ok = 0, missing = 0, lastError: string | null = null;
  for (let i = 0; i < batch.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100));
    const s = batch[i];
    const res = await fetchStreetNominatim(s.name, t.city, t.zip);
    const now = new Date().toISOString();
    if (res.status === "ok") { ok++; await supabase.from("territory_streets").update({ geom_status: "ok", geom: res.lines, geom_updated_at: now }).eq("id", s.id); }
    else if (res.status === "no_encontrada") { missing++; await supabase.from("territory_streets").update({ geom_status: "no_encontrada", geom_updated_at: now }).eq("id", s.id); }
    else { lastError = res.error; await supabase.from("territory_streets").update({ geom_status: "error", geom_updated_at: now }).eq("id", s.id); break; }
  }
  revalidatePath("/mapa");
  if (lastError) return { ok: false, error: `${lastError} Se reintentará más tarde.` };
  return { ok: true, found: ok, missing, remaining: pending.length - batch.length };
}

// ---------------------------------------------------------------------
// Visitas a calles o tramos
// ---------------------------------------------------------------------
export async function addStreetVisit(input: {
  streetId: string; date?: string; segment?: string; doors?: number | null; notes?: string; markStatus?: "" | "en_progreso" | "terminada";
}): Promise<R> {
  const { supabase, profile } = await getSession();
  if (!isUuid(input.streetId)) return { ok: false, error: "Calle no válida." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") ? input.date! : todayTX();
  if (date > todayTX()) return { ok: false, error: "La fecha de visita no puede ser futura." };
  const doors = input.doors == null || input.doors === ("" as any) ? null : Math.round(Number(input.doors));
  if (doors !== null && (!Number.isFinite(doors) || doors < 0 || doors > 1000)) return { ok: false, error: "Número de puertas no válido." };

  const { error } = await supabase.from("street_visits").insert({
    street_id: input.streetId, visited_on: date, visited_by: profile.id,
    segment: (input.segment ?? "").trim().slice(0, 120) || null,
    doors, notes: (input.notes ?? "").trim().slice(0, 1000) || null,
  });
  if (error) return { ok: false, error: "No se pudo guardar la visita." };

  // Una visita deja la calle "en progreso" si estaba pendiente; solo se marca terminada si el usuario lo elige
  const { data: s } = await supabase.from("territory_streets").select("status, doors_knocked, territory_id").eq("id", input.streetId).maybeSingle();
  if (s) {
    const patch: Record<string, unknown> = { last_visit_at: new Date().toISOString(), last_visit_by: profile.id };
    if (doors) patch.doors_knocked = (s.doors_knocked ?? 0) + doors;
    if (input.markStatus === "terminada") patch.status = "terminada";
    else if (input.markStatus === "en_progreso") patch.status = "en_progreso";
    else if (s.status === "pendiente") patch.status = "en_progreso";
    await supabase.from("territory_streets").update(patch).eq("id", input.streetId);
    revalidatePath(`/territorios/${s.territory_id}`);
  }
  revalidatePath("/mapa");
  revalidatePath("/territorios");
  return { ok: true };
}

export async function getStreetVisits(streetId: string): Promise<R<{ visits: { id: string; visited_on: string; segment: string | null; doors: number | null; notes: string | null; who: string | null; mine: boolean }[] }>> {
  const { supabase, profile } = await getSession();
  if (!isUuid(streetId)) return { ok: false, error: "Calle no válida." };
  const { data, error } = await supabase.from("street_visits")
    .select("id, visited_on, segment, doors, notes, visited_by, who:profiles!street_visits_visited_by_fkey(full_name)")
    .eq("street_id", streetId).order("visited_on", { ascending: false }).order("created_at", { ascending: false }).limit(30);
  if (error) return { ok: false, error: "No se pudieron leer las visitas." };
  return {
    ok: true,
    visits: (data ?? []).map((v: any) => ({
      id: v.id, visited_on: v.visited_on, segment: v.segment, doors: v.doors, notes: v.notes,
      who: (Array.isArray(v.who) ? v.who[0] : v.who)?.full_name ?? null, mine: v.visited_by === profile.id,
    })),
  };
}

export async function deleteStreetVisit(id: string): Promise<R> {
  const { supabase } = await getSession();
  if (!isUuid(id)) return { ok: false, error: "Visita no válida." };
  const { error, count } = await supabase.from("street_visits").delete({ count: "exact" }).eq("id", id);
  if (error || !count) return { ok: false, error: "Solo puedes borrar tus propias visitas." };
  revalidatePath("/mapa");
  return { ok: true };
}

// ---------------------------------------------------------------------
// Ruta del día (por vendedor y fecha)
// ---------------------------------------------------------------------
export type RoutePayload = {
  date: string;
  start_mode: "ninguno" | "gps" | "manual";
  start_label: string | null;
  start_lat: number | null;
  start_lng: number | null;
  stops: string[];
  order_mode: "manual" | "cercania";
};

export async function saveRoute(p: RoutePayload): Promise<R<{ updated_at: string }>> {
  const { supabase, profile } = await getSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return { ok: false, error: "Fecha no válida." };
  const stops = Array.from(new Set((p.stops ?? []).filter(isUuid))).slice(0, 60);
  // Solo se guardan paradas que el usuario puede ver
  let allowed: string[] = [];
  if (stops.length) {
    const { data } = await supabase.from("jobs").select("id").in("id", stops);
    const ok = new Set((data ?? []).map((r) => r.id));
    allowed = stops.filter((s) => ok.has(s));
  }
  const hasStart = p.start_mode !== "ninguno" && isLatLng({ lat: p.start_lat, lng: p.start_lng });
  const row = {
    owner_id: profile.id, route_date: p.date,
    start_mode: hasStart ? p.start_mode : "ninguno",
    start_label: hasStart ? (p.start_label ?? "").slice(0, 200) || null : null,
    start_lat: hasStart ? p.start_lat : null, start_lng: hasStart ? p.start_lng : null,
    stops: allowed.map((job_id) => ({ job_id })),
    order_mode: p.order_mode === "cercania" ? "cercania" : "manual",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("day_routes").upsert(row, { onConflict: "owner_id,route_date" }).select("updated_at").single();
  if (error) return { ok: false, error: "No se pudo guardar la ruta." };
  return { ok: true, updated_at: data.updated_at };
}

export async function getRoute(date: string, ownerId?: string): Promise<R<{ route: RoutePayload & { owner_id: string; updated_at: string } | null }>> {
  const { supabase, profile } = await getSession();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Fecha no válida." };
  const owner = ownerId && isUuid(ownerId) ? ownerId : profile.id;
  const { data } = await supabase.from("day_routes").select("*").eq("owner_id", owner).eq("route_date", date).maybeSingle();
  if (!data) return { ok: true, route: null };
  return {
    ok: true,
    route: {
      owner_id: data.owner_id, updated_at: data.updated_at, date: data.route_date,
      start_mode: data.start_mode, start_label: data.start_label, start_lat: data.start_lat, start_lng: data.start_lng,
      stops: (data.stops ?? []).map((s: any) => s.job_id).filter(isUuid), order_mode: data.order_mode,
    },
  };
}

// ---------------------------------------------------------------------
// Referencias cercanas (firmados, en proceso o terminados)
// Nombre y dirección solo llegan si el cliente autorizó la referencia.
// ---------------------------------------------------------------------
export type NearbyRef = {
  job_id: string | null; distance_m: number; status: string; street: string | null;
  authorized: boolean; customer_name: string | null; address: string | null; can_open: boolean;
};

export async function getNearby(jobId: string, radiusM = 1609): Promise<R<{ refs: NearbyRef[] }>> {
  const { supabase } = await getSession();
  if (!isUuid(jobId)) return { ok: false, error: "Trabajo no válido." };
  const r = Math.min(Math.max(Math.round(radiusM), 100), 8000);
  const { data, error } = await supabase.rpc("nearby_jobs", { p_job: jobId, p_radius_m: r });
  if (error) return { ok: false, error: "No se pudieron buscar trabajos cercanos." };
  return { ok: true, refs: (data ?? []) as NearbyRef[] };
}
