"use server";
import { revalidatePath } from "next/cache";
import { getSession, isStaff } from "@/lib/auth";
import { isUuid } from "@/lib/files";
import { localToISO, todayTX } from "@/lib/format";
import {
  addrKey, houseCounts, isHouseStatus, streetPriority, streetStormHistory,
  type EventIn, type HouseStatus, type StormCard, type SwathIn,
} from "@/lib/street-intel";

type R<T = {}> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const errMsg = (e: { message?: string } | null | undefined, fallback: string) => {
  const m = e?.message ?? "";
  if (m.includes("CONFLICTO")) return "Otra persona actualizó esta casa hace un momento. Se recargaron los datos; revisa y vuelve a intentar.";
  if (/Solo la oficina|no válido|vacía|no encontrada|No puedes|no activo/i.test(m)) return m;
  return fallback;
};

export type IntelHouse = {
  id: string; number: number | null; situs: string; owner: string | null; ownerOccupied: boolean | null; yearBuilt: number | null;
  status: HouseStatus; statusAt: string | null; statusBy: string | null; assignedId: string | null; assignedName: string | null;
  job: { id: string; number: number; status: string } | null; possibleJob: { id: string; number: number } | null; note: string | null;
};
export type IntelEvent = { id: string; houseId: string; sessionId?: string | null; kind: string; status: string | null; note: string | null; actor: string | null; at: string };
export type IntelSession = { id: string; userId: string; userName: string | null; startedAt: string; lastHouseId: string | null; visited: number; skipped: number; leads: number; appointments: number };
export type StreetIntel = {
  street: { id: string; name: string; status: string; territoryId: string; territoryCode: string; city: string | null; zip: string | null; doors: number; leads: number; lastVisit: string | null; ownersStatus: string | null };
  houses: IntelHouse[];
  counts: ReturnType<typeof houseCounts>;
  inspections: { scheduled: number; next: string | null };
  assigned: string[];
  storms: StormCard[];
  priority: ReturnType<typeof streetPriority>;
  events: IntelEvent[];
  sessions: IntelSession[];
  mySession: IntelSession | null;
  staff: boolean;
  loadedAt: string;
};

export async function getStreetIntel(streetId: string): Promise<R<{ intel: StreetIntel }>> {
  if (!isUuid(streetId)) return { ok: false, error: "Calle no válida." };
  const { supabase, profile } = await getSession();
  const { data: s, error } = await supabase.from("territory_streets")
    .select("id, name, status, territory_id, doors_knocked, leads, last_visit_at, geom, geom_status, owners_status, territory:territories(code, city, zip)")
    .eq("id", streetId).maybeSingle();
  if (error || !s) return { ok: false, error: "No se pudo leer la calle." };
  const t = one<any>((s as any).territory);
  const lines: [number, number][][] = s.geom_status === "ok" && Array.isArray(s.geom) ? s.geom as any : [];

  // Caja alrededor de la calle (~4 mi) para traer solo eventos cercanos
  const nodes = lines.flat();
  const bb = nodes.length ? [
    Math.min(...nodes.map((p) => p[0])) - 0.06, Math.min(...nodes.map((p) => p[1])) - 0.07,
    Math.max(...nodes.map((p) => p[0])) + 0.06, Math.max(...nodes.map((p) => p[1])) + 0.07,
  ] : null;

  const [housesRes, evRes, sessRes, stormRes, swathRes, zipAssign] = await Promise.all([
    supabase.from("street_houses")
      .select("id, house_number, situs, owner_name, owner_occupied, year_built, status, status_updated_at, last_note, assigned_to, job_id, updater:profiles!street_houses_status_updated_by_fkey(full_name), assignee:profiles!street_houses_assigned_to_fkey(full_name), job:jobs(id, number, status)")
      .eq("street_id", streetId).order("house_number", { ascending: true, nullsFirst: false }).limit(1000),
    supabase.from("house_events").select("id, house_id, kind, status, note, session_id, created_at, actor:profiles(full_name)")
      .eq("street_id", streetId).order("created_at", { ascending: false }).limit(60),
    supabase.from("canvass_sessions").select("id, user_id, started_at, last_house_id, visited, skipped, leads, appointments, who:profiles(full_name)")
      .eq("street_id", streetId).is("ended_at", null).order("started_at", { ascending: false }),
    bb ? supabase.from("storm_events").select("id, source_key, event_type, event_date, lat, lng, hail_in, wind_mph, location_text, data_quality, comments")
      .gte("lat", bb[0]).lte("lat", bb[2]).gte("lng", bb[1]).lte("lng", bb[3]).order("event_date", { ascending: false }).limit(300) : Promise.resolve({ data: [] as any[] }),
    bb ? supabase.from("storm_swaths").select("id, source_key, event_date, min_hail_in, geom, bbox") : Promise.resolve({ data: [] as any[] }),
    t?.zip ? supabase.from("zip_assignments").select("rep:profiles!zip_assignments_rep_id_fkey(full_name)").eq("zip", t.zip).is("ends_on", null) : Promise.resolve({ data: [] as any[] }),
  ]);
  if (housesRes.error) return { ok: false, error: "No se pudieron leer las casas de la calle." };

  const rows = (housesRes.data ?? []) as any[];
  // Leads existentes con la misma dirección (para enlazar en vez de duplicar)
  const unlinked = rows.filter((h) => !h.job_id);
  const possible = new Map<string, { id: string; number: number }>();
  if (unlinked.length) {
    const word = String(s.name).split(" ")[0];
    const { data: jobs } = await supabase.from("jobs").select("id, number, address").ilike("address", `%${word}%`).limit(500);
    const byKey = new Map<string, { id: string; number: number }>();
    for (const j of jobs ?? []) if (j.address) byKey.set(addrKey(j.address), { id: j.id, number: j.number });
    for (const h of unlinked) { const m = byKey.get(addrKey(h.situs)); if (m) possible.set(h.id, m); }
  }

  const houses: IntelHouse[] = rows.map((h) => ({
    id: h.id, number: h.house_number, situs: String(h.situs).split(",")[0], owner: h.owner_name, ownerOccupied: h.owner_occupied, yearBuilt: h.year_built,
    status: isHouseStatus(h.status) ? h.status : "not_visited", statusAt: h.status_updated_at, statusBy: one<any>(h.updater)?.full_name ?? null,
    assignedId: h.assigned_to, assignedName: one<any>(h.assignee)?.full_name ?? null,
    job: one<any>(h.job) ? { id: one<any>(h.job).id, number: one<any>(h.job).number, status: one<any>(h.job).status } : null,
    possibleJob: possible.get(h.id) ?? null, note: h.last_note,
  }));
  const counts = houseCounts(houses);

  // Inspecciones agendadas de los trabajos enlazados a casas de esta calle
  const jobIds = houses.map((h) => h.job?.id).filter(Boolean) as string[];
  let inspections = { scheduled: 0, next: null as string | null };
  if (jobIds.length) {
    const { data: ap } = await supabase.from("appointments").select("starts_at").eq("kind", "inspeccion").in("job_id", jobIds)
      .gte("starts_at", new Date().toISOString()).order("starts_at");
    inspections = { scheduled: ap?.length ?? 0, next: ap?.[0]?.starts_at ?? null };
  }

  const swaths = ((swathRes.data ?? []) as any[]).filter((w) => !bb || !w.bbox || !(w.bbox[2] < bb[0] || w.bbox[0] > bb[2] || w.bbox[3] < bb[1] || w.bbox[1] > bb[3]))
    .map((w) => ({ ...w, min_hail_in: Number(w.min_hail_in) })) as SwathIn[];
  const storms = streetStormHistory(lines, ((stormRes.data ?? []) as any[]).map((e) => ({ ...e, hail_in: e.hail_in == null ? null : Number(e.hail_in) })) as EventIn[], swaths);
  const priority = streetPriority({ cards: storms, counts, today: todayTX() });

  const sessions: IntelSession[] = ((sessRes.data ?? []) as any[]).map((x) => ({
    id: x.id, userId: x.user_id, userName: one<any>(x.who)?.full_name ?? null, startedAt: x.started_at, lastHouseId: x.last_house_id,
    visited: x.visited, skipped: x.skipped, leads: x.leads, appointments: x.appointments,
  }));
  const assigned = Array.from(new Set([
    ...houses.map((h) => h.assignedName).filter(Boolean) as string[],
    ...((zipAssign.data ?? []) as any[]).map((a) => one<any>(a.rep)?.full_name).filter(Boolean),
  ]));

  return {
    ok: true,
    intel: {
      street: {
        id: s.id, name: s.name, status: s.status, territoryId: s.territory_id, territoryCode: t?.code ?? "", city: t?.city ?? null, zip: t?.zip ?? null,
        doors: s.doors_knocked ?? 0, leads: s.leads ?? 0, lastVisit: s.last_visit_at, ownersStatus: s.owners_status,
      },
      houses, counts, inspections, assigned, storms, priority,
      events: ((evRes.data ?? []) as any[]).map((e) => ({ id: e.id, houseId: e.house_id, sessionId: e.session_id, kind: e.kind, status: e.status, note: e.note, actor: one<any>(e.actor)?.full_name ?? null, at: e.created_at })),
      sessions, mySession: sessions.find((x) => x.userId === profile.id) ?? null,
      staff: isStaff(profile), loadedAt: new Date().toISOString(),
    },
  };
}

export async function setHouseStatus(input: { houseId: string; status: string; kind?: "status" | "visit" | "skip"; note?: string; sessionId?: string | null; expected?: string | null }): Promise<R<{ statusAt: string }>> {
  if (!isUuid(input.houseId) || !isHouseStatus(input.status)) return { ok: false, error: "Datos no válidos." };
  if (input.sessionId && !isUuid(input.sessionId)) return { ok: false, error: "Recorrido no válido." };
  const { supabase } = await getSession();
  const { data, error } = await supabase.rpc("set_house_status", {
    p_house: input.houseId, p_status: input.status, p_note: input.note?.slice(0, 500) ?? null, p_kind: input.kind ?? "status",
    p_session: input.sessionId ?? null, p_expected: input.expected ?? null,
  });
  if (error) return { ok: false, error: errMsg(error, "No se pudo guardar el estado."), conflict: error.message.includes("CONFLICTO") };
  if (input.kind === "visit") revalidatePath("/mapa");
  return { ok: true, statusAt: (data as any)?.status_updated_at ?? new Date().toISOString() };
}

export async function addHouseNote(houseId: string, note: string): Promise<R> {
  if (!isUuid(houseId)) return { ok: false, error: "Casa no válida." };
  if (!note.trim()) return { ok: false, error: "Escribe la nota." };
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("add_house_note", { p_house: houseId, p_note: note.slice(0, 1000) });
  return error ? { ok: false, error: errMsg(error, "No se pudo guardar la nota.") } : { ok: true };
}

export async function assignHouses(houseIds: string[], userId: string | null): Promise<R<{ done: number }>> {
  if (!houseIds.length || houseIds.some((id) => !isUuid(id)) || (userId && !isUuid(userId))) return { ok: false, error: "Datos no válidos." };
  const { supabase, profile } = await getSession();
  if (!isStaff(profile)) return { ok: false, error: "Solo la oficina puede asignar vendedores." };
  let done = 0;
  for (const id of houseIds.slice(0, 300)) {
    const { error } = await supabase.rpc("assign_house", { p_house: id, p_user: userId });
    if (error) return { ok: false, error: errMsg(error, `Se asignaron ${done}; falló una casa.`) };
    done++;
  }
  return { ok: true, done };
}

export async function linkHouseToJob(houseId: string, jobId: string): Promise<R> {
  if (!isUuid(houseId) || !isUuid(jobId)) return { ok: false, error: "Datos no válidos." };
  const { supabase } = await getSession();
  const { data: h } = await supabase.from("street_houses").select("job_id").eq("id", houseId).maybeSingle();
  if (h?.job_id && h.job_id !== jobId) return { ok: false, error: "Esta casa ya está enlazada a otro trabajo. Pide a la oficina que lo revise." };
  const { error } = await supabase.rpc("link_house_job", { p_house: houseId, p_job: jobId, p_kind: "lead" });
  return error ? { ok: false, error: errMsg(error, "No se pudo enlazar.") } : { ok: true };
}

export async function scheduleHouseInspection(input: { houseId: string; startsAt: string; notes?: string }): Promise<R<{ jobId: string }>> {
  if (!isUuid(input.houseId)) return { ok: false, error: "Casa no válida." };
  const starts = localToISO(input.startsAt);
  if (!starts) return { ok: false, error: "Escoge fecha y hora." };
  if (Date.parse(starts) < Date.now() - 3600_000) return { ok: false, error: "La fecha ya pasó." };
  const { supabase, profile } = await getSession();
  const { data: h } = await supabase.from("street_houses").select("id, situs, job_id, status").eq("id", input.houseId).maybeSingle();
  if (!h) return { ok: false, error: "Casa no encontrada." };
  if (h.status === "do_not_contact") return { ok: false, error: "Esta casa está marcada como No contactar." };
  if (!h.job_id) return { ok: false, error: "Primero crea o enlaza el lead de esta casa." };
  const { data: job } = await supabase.from("jobs").select("id, name, status, contact_id, sales_rep_id").eq("id", h.job_id).maybeSingle();
  if (!job) return { ok: false, error: "No puedes ver el trabajo de esta casa." };

  // Evita duplicar la misma cita por doble clic
  const { data: dup } = await supabase.from("appointments").select("id").eq("job_id", job.id).eq("kind", "inspeccion").eq("starts_at", starts).limit(1);
  if (!dup?.length) {
    const { error } = await supabase.from("appointments").insert({
      title: `Inspección · ${job.name}`, kind: "inspeccion", starts_at: starts, location: h.situs,
      assigned_to: job.sales_rep_id ?? profile.id, job_id: job.id, contact_id: job.contact_id, notes: input.notes?.slice(0, 1000) || null,
    });
    if (error) return { ok: false, error: "No se pudo crear la cita." };
  }
  // Pipeline: solo avanza si el trabajo seguía al inicio; nunca retrocede
  if (["lead_nuevo", "contactado"].includes(job.status)) {
    await supabase.from("jobs").update({ status: "inspeccion_agendada" }).eq("id", job.id);
    await supabase.from("activities").insert({ job_id: job.id, contact_id: job.contact_id, author_id: profile.id, kind: "cambio_estado", body: "Inspección agendada desde Street Intelligence" });
  }
  const { error: le } = await supabase.rpc("link_house_job", { p_house: h.id, p_job: job.id, p_kind: "appointment" });
  if (le) return { ok: false, error: errMsg(le, "La cita se creó, pero no se pudo marcar la casa.") };
  revalidatePath("/calendario"); revalidatePath(`/trabajos/${job.id}`); revalidatePath("/");
  return { ok: true, jobId: job.id };
}

export async function getHouseHistory(houseId: string): Promise<R<{ events: IntelEvent[] }>> {
  if (!isUuid(houseId)) return { ok: false, error: "Casa no válida." };
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("house_events").select("id, house_id, kind, status, note, created_at, actor:profiles(full_name)")
    .eq("house_id", houseId).order("created_at", { ascending: false }).limit(50);
  if (error) return { ok: false, error: "No se pudo leer el historial." };
  return { ok: true, events: ((data ?? []) as any[]).map((e) => ({ id: e.id, houseId: e.house_id, kind: e.kind, status: e.status, note: e.note, actor: one<any>(e.actor)?.full_name ?? null, at: e.created_at })) };
}

// ---------------- Recorridos ----------------
export async function startCanvass(streetId: string): Promise<R<{ sessionId: string; resumed: boolean }>> {
  if (!isUuid(streetId)) return { ok: false, error: "Calle no válida." };
  const { supabase, profile } = await getSession();
  const { data: open } = await supabase.from("canvass_sessions").select("id").eq("street_id", streetId).eq("user_id", profile.id).is("ended_at", null).limit(1);
  if (open?.length) return { ok: true, sessionId: open[0].id, resumed: true };
  // Reanudar: toma la última casa del recorrido anterior en esta calle
  const { data: prev } = await supabase.from("canvass_sessions").select("last_house_id").eq("street_id", streetId).eq("user_id", profile.id)
    .order("started_at", { ascending: false }).limit(1);
  const { data, error } = await supabase.from("canvass_sessions").insert({ street_id: streetId, user_id: profile.id, last_house_id: prev?.[0]?.last_house_id ?? null }).select("id").single();
  if (error) return { ok: false, error: "No se pudo iniciar el recorrido." };
  return { ok: true, sessionId: data.id, resumed: false };
}

export async function finishCanvass(sessionId: string, summary: string): Promise<R> {
  if (!isUuid(sessionId)) return { ok: false, error: "Recorrido no válido." };
  const { supabase, profile } = await getSession();
  const { error } = await supabase.from("canvass_sessions").update({ ended_at: new Date().toISOString(), summary: summary.slice(0, 1000) || null })
    .eq("id", sessionId).eq("user_id", profile.id).is("ended_at", null);
  if (error) return { ok: false, error: "No se pudo cerrar el recorrido." };
  revalidatePath("/mapa");
  return { ok: true };
}

// ---------------- Lead rápido desde una casa (sin salir del mapa) ----------------
export async function createLeadFromHouse(input: { houseId: string; first: string; last: string; phone?: string; email?: string; apptAt?: string; notes?: string }): Promise<R<{ jobId: string; number: number }>> {
  if (!isUuid(input.houseId)) return { ok: false, error: "Casa no válida." };
  const first = input.first.trim().slice(0, 80), last = input.last.trim().slice(0, 80);
  if (!first) return { ok: false, error: "Escribe el nombre del cliente." };
  const phone = input.phone?.replace(/[^\d+() -]/g, "").trim().slice(0, 30) || null;
  const email = input.email?.trim().slice(0, 120) || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "El correo no es válido." };
  const appt = input.apptAt ? localToISO(input.apptAt) : null;
  if (input.apptAt && !appt) return { ok: false, error: "La fecha de la inspección no es válida." };

  const { supabase, profile } = await getSession();
  const { data: h } = await supabase.from("street_houses")
    .select("id, situs, status, job_id, street_id, street:territory_streets(id, territory_id, leads, territory:territories(city, zip, storm_date))")
    .eq("id", input.houseId).maybeSingle();
  if (!h) return { ok: false, error: "Casa no encontrada." };
  if (h.status === "do_not_contact") return { ok: false, error: "Esta casa está marcada como No contactar." };
  if (h.job_id) return { ok: false, error: "Esta casa ya tiene un lead. Ábrelo desde la lista." };
  const st = one<any>((h as any).street); const terr = one<any>(st?.territory);
  const address = String(h.situs).split(",")[0];
  // Duplicado por dirección: enlazar el existente en vez de crear otro
  const { data: same } = await supabase.from("jobs").select("id, number, address").ilike("address", `${address.split(" ")[0]} %`).limit(200);
  const dup = (same ?? []).find((j) => addrKey(j.address) === addrKey(address));
  if (dup) return { ok: false, error: `Ya existe el trabajo #${dup.number} con esta dirección. Usa "Enlazar" para no duplicarlo.` };

  const { data: c, error: ce } = await supabase.from("contacts").insert({
    first_name: first, last_name: last, phone, email, address, city: terr?.city ?? null, zip: terr?.zip ?? null,
    source: "door_to_door", territory_id: st?.territory_id ?? null, owner_id: profile.id,
  }).select("id").single();
  if (ce) return { ok: false, error: "No se pudo crear el contacto." };
  const name = `Techo – ${[first, last].filter(Boolean).join(" ")}`;
  const { data: job, error: je } = await supabase.from("jobs").insert({
    name, job_type: "seguro", status: appt ? "inspeccion_agendada" : "lead_nuevo", contact_id: c.id, sales_rep_id: profile.id,
    address, city: terr?.city ?? null, zip: terr?.zip ?? null, territory_id: st?.territory_id ?? null, storm_date: terr?.storm_date ?? null,
    notes: input.notes?.slice(0, 1000) || null,
  }).select("id, number").single();
  if (je) return { ok: false, error: "No se pudo crear el trabajo." };
  if (st) await supabase.from("territory_streets").update({ leads: (st.leads ?? 0) + 1 }).eq("id", st.id);
  if (appt) {
    await supabase.from("appointments").insert({ title: `Inspección · ${name}`, kind: "inspeccion", starts_at: appt, location: h.situs, assigned_to: profile.id, job_id: job.id, contact_id: c.id });
  }
  await supabase.from("activities").insert({ job_id: job.id, contact_id: c.id, author_id: profile.id, kind: "sistema", body: "Lead creado puerta a puerta desde Street Intelligence" });
  await supabase.rpc("link_house_job", { p_house: h.id, p_job: job.id, p_kind: "lead" });
  if (appt) await supabase.rpc("link_house_job", { p_house: h.id, p_job: job.id, p_kind: "appointment" });
  revalidatePath("/trabajos"); revalidatePath("/"); if (appt) revalidatePath("/calendario");
  return { ok: true, jobId: job.id, number: job.number };
}
