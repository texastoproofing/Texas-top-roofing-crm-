"use server";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { syncSpcRange } from "@/lib/storm-server";
import { todayTX } from "@/lib/format";
import { isUuid } from "@/lib/files";
import { DEFAULT_WEIGHTS, type Weights } from "@/lib/storm";

type R<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Reportes recientes (últimos 4 días SPC). Cualquier usuario activo lo dispara si la última sincronización tiene más de 6 h.
export async function syncRecent(force = false): Promise<R<{ inserted: number; alerts: number; skippedBecauseFresh?: boolean }>> {
  const { supabase, profile } = await getSession();
  if (force && profile.role !== "administrador") return { ok: false, error: "Solo el administrador puede forzar la actualización." };
  if (!force) {
    const { data: last } = await supabase.from("storm_sync_jobs").select("started_at, range_end")
      .eq("source_key", "spc").in("status", ["ok", "parcial", "en_curso"]).gte("range_end", addDays(todayTX(), -1))
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - new Date(last.started_at).getTime() < 6 * 3600 * 1000) return { ok: true, inserted: 0, alerts: 0, skippedBecauseFresh: true };
  }
  try {
    const today = todayTX();
    const r = await syncSpcRange(addDays(today, -4), today, { alerts: true, startedBy: profile.id });
    revalidatePath("/tormentas");
    if (r.status === "error") return { ok: false, error: "NOAA/SPC no respondió. Se reintentará más tarde." };
    return { ok: true, inserted: r.inserted, alerts: r.alerts };
  } catch (e) {
    return { ok: false, error: (e as Error).message.includes("SUPABASE_SERVICE_ROLE_KEY") ? "Falta configurar la llave de servicio en Vercel." : "No se pudo actualizar desde NOAA/SPC." };
  }
}

// Historial: importa por lotes de 20 días desde la fecha de inicio. Sin alertas (son reportes históricos).
export async function syncHistoryBatch(fromDate: string): Promise<R<{ next: string | null; inserted: number; to: string }>> {
  const { profile } = await requireAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return { ok: false, error: "Fecha no válida." };
  const today = todayTX();
  const to = [addDays(fromDate, 19), addDays(today, -5)].sort()[0];
  if (fromDate > to) return { ok: true, next: null, inserted: 0, to: fromDate };
  try {
    const r = await syncSpcRange(fromDate, to, { alerts: false, startedBy: profile.id });
    if (r.status === "error") return { ok: false, error: `NOAA/SPC no respondió para ${fromDate}–${to}. Puedes reintentar.` };
    revalidatePath("/tormentas");
    const next = addDays(to, 1);
    return { ok: true, next: next <= addDays(today, -5) ? next : null, inserted: r.inserted, to };
  } catch {
    return { ok: false, error: "No se pudo importar el historial." };
  }
}

export async function saveStormSettings(input: { weights: Weights; alert_min_hail_in: number; alert_min_wind_mph: number }): Promise<R> {
  const { supabase, profile } = await requireAdmin();
  const w: any = {};
  for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
    const v = Math.round(Number(input.weights?.[k]));
    if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: "Cada peso debe estar entre 0 y 100." };
    w[k] = v;
  }
  if (Object.values(w).reduce((a: number, b: any) => a + b, 0) === 0) return { ok: false, error: "Al menos un peso debe ser mayor que 0." };
  const hail = Number(input.alert_min_hail_in), wind = Math.round(Number(input.alert_min_wind_mph));
  if (!(hail >= 0.25 && hail <= 6)) return { ok: false, error: "El granizo mínimo debe estar entre 0.25 y 6 pulgadas." };
  if (!(wind >= 30 && wind <= 150)) return { ok: false, error: "El viento mínimo debe estar entre 30 y 150 mph." };
  const { error } = await supabase.from("storm_settings").update({
    weights: w, alert_min_hail_in: hail, alert_min_wind_mph: wind, updated_by: profile.id, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) return { ok: false, error: "No se pudo guardar." };
  await supabase.from("audit_logs").insert({ actor: profile.id, action: "actualizar", entity: "storm_settings", entity_id: "1", details: { weights: w, hail, wind } });
  revalidatePath("/tormentas");
  return { ok: true };
}

export async function assignZip(input: { zip: string; repId: string; startsOn?: string; notes?: string }): Promise<R> {
  const { supabase, profile } = await requireAdmin();
  const zip = (input.zip ?? "").trim();
  if (!/^\d{5}$/.test(zip)) return { ok: false, error: "ZIP no válido (5 dígitos)." };
  if (!isUuid(input.repId)) return { ok: false, error: "Elige un vendedor." };
  const { data: open } = await supabase.from("zip_assignments").select("id, rep:profiles!zip_assignments_rep_id_fkey(full_name)").eq("zip", zip).is("ends_on", null).maybeSingle();
  if (open) return { ok: false, error: `El ZIP ${zip} ya está asignado a ${(open as any).rep?.full_name ?? "otro vendedor"}. Termina esa asignación primero.` };
  const { error } = await supabase.from("zip_assignments").insert({
    zip, rep_id: input.repId, starts_on: /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn ?? "") ? input.startsOn : todayTX(),
    notes: (input.notes ?? "").trim() || null, created_by: profile.id,
  });
  if (error) return { ok: false, error: error.code === "23505" ? "Ese ZIP ya tiene una asignación activa." : "No se pudo asignar." };
  await supabase.from("audit_logs").insert({ actor: profile.id, action: "asignar", entity: "zip_assignments", entity_id: zip, details: { rep: input.repId } });
  revalidatePath("/tormentas");
  return { ok: true };
}

export async function endAssignment(id: string): Promise<R> {
  const { supabase, profile } = await requireAdmin();
  if (!isUuid(id)) return { ok: false, error: "Asignación no válida." };
  const { error } = await supabase.from("zip_assignments").update({ ends_on: todayTX() }).eq("id", id).is("ends_on", null);
  if (error) return { ok: false, error: "No se pudo terminar la asignación." };
  await supabase.from("audit_logs").insert({ actor: profile.id, action: "terminar", entity: "zip_assignments", entity_id: id });
  revalidatePath("/tormentas");
  return { ok: true };
}

export async function reviewAlert(id: string): Promise<R> {
  const { supabase, profile } = await getSession();
  if (!isUuid(id)) return { ok: false, error: "Alerta no válida." };
  const { error } = await supabase.from("storm_alerts").update({ status: "revisada", reviewed_by: profile.id, reviewed_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: "No se pudo marcar." };
  revalidatePath("/tormentas");
  return { ok: true };
}
