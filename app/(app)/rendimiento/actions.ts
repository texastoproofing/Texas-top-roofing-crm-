"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/files";
import { cents, commissionFor, dayTX, planAt, reachedAt, saleValue, grossProfit, sharesOf } from "@/lib/sales";
import { loadSales } from "@/lib/sales-server";

type R = { ok: true; msg?: string } | { ok: false; error: string };
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const money = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? cents(n) : NaN;
};
const pct = (v: unknown) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN; };
async function admin() {
  const s = await getSession();
  if (s.profile.role !== "administrador") throw new Error("Solo el administrador puede cambiar esto.");
  return s;
}
const done = (msg?: string): R => { revalidatePath("/rendimiento", "layout"); return { ok: true, msg }; };
const fail = (e: unknown): R => ({ ok: false, error: e instanceof Error ? e.message : "No se pudo guardar." });

export async function saveRepProfile(input: { userId: string; hireDate: string; supervisorId: string; territoryId: string }): Promise<R> {
  try {
    const { supabase } = await admin();
    if (!isUuid(input.userId)) return { ok: false, error: "Vendedor no válido." };
    if (input.supervisorId === input.userId) return { ok: false, error: "Un vendedor no puede ser su propio supervisor." };
    const { error } = await supabase.from("rep_profiles").upsert({
      user_id: input.userId, hire_date: date(input.hireDate), supervisor_id: isUuid(input.supervisorId) ? input.supervisorId : null,
      territory_id: isUuid(input.territoryId) ? input.territoryId : null, updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: "No se pudo guardar el vendedor." };
    return done("Datos del vendedor guardados.");
  } catch (e) { return fail(e); }
}

export async function saveCommissionPlan(input: { userId: string; model: string; profitPct: string; salesPct: string; fixed: string; from: string; to: string; notes: string }): Promise<R> {
  try {
    const { supabase } = await admin();
    if (!isUuid(input.userId)) return { ok: false, error: "Vendedor no válido." };
    if (!["profit_pct", "sales_pct", "fixed", "mixed"].includes(input.model)) return { ok: false, error: "Modelo no válido." };
    const pp = pct(input.profitPct), sp = pct(input.salesPct), fx = money(input.fixed);
    if (Number.isNaN(pp) || Number.isNaN(sp)) return { ok: false, error: "Los porcentajes deben estar entre 0 y 100." };
    if (Number.isNaN(fx) || (fx != null && fx < 0)) return { ok: false, error: "La comisión fija no es válida." };
    if (input.model === "profit_pct" && pp == null) return { ok: false, error: "Escribe el % del profit." };
    if (input.model === "sales_pct" && sp == null) return { ok: false, error: "Escribe el % de la venta." };
    if (input.model === "fixed" && fx == null) return { ok: false, error: "Escribe el monto fijo." };
    if (input.model === "mixed" && [pp, sp, fx].filter((x) => x != null).length < 2) return { ok: false, error: "El modelo mixto necesita al menos dos partes." };
    const from = date(input.from), to = date(input.to);
    if (!from) return { ok: false, error: "Escribe desde cuándo aplica." };
    if (to && to < from) return { ok: false, error: "La fecha final es antes de la inicial." };
    // Cierra el plan vigente anterior el día antes (no se borra: queda el historial)
    const { data: open } = await supabase.from("commission_plans").select("id, valid_from").eq("user_id", input.userId).is("valid_to", null).lt("valid_from", from);
    for (const p of open ?? []) {
      const d = new Date(from + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
      await supabase.from("commission_plans").update({ valid_to: d.toISOString().slice(0, 10) }).eq("id", p.id);
    }
    const { error } = await supabase.from("commission_plans").insert({
      user_id: input.userId, model: input.model,
      profit_pct: input.model === "sales_pct" || input.model === "fixed" ? null : pp,
      sales_pct: input.model === "profit_pct" || input.model === "fixed" ? null : sp,
      fixed_amount: input.model === "profit_pct" || input.model === "sales_pct" ? null : fx,
      valid_from: from, valid_to: to, notes: input.notes?.slice(0, 500) || null,
    });
    if (error) return { ok: false, error: "No se pudo guardar el plan." };
    return done("Plan de comisión guardado.");
  } catch (e) { return fail(e); }
}

export async function saveJobFinancials(input: { jobId: string; contract: string; costs: string; notes: string }): Promise<R> {
  try {
    const { supabase, profile } = await admin();
    if (!isUuid(input.jobId)) return { ok: false, error: "Trabajo no válido." };
    const c = money(input.contract), k = money(input.costs);
    if (Number.isNaN(c) || Number.isNaN(k) || (c != null && c < 0) || (k != null && k < 0)) return { ok: false, error: "Montos no válidos." };
    const { data: prev } = await supabase.from("job_financials").select("contract_amount, direct_costs").eq("job_id", input.jobId).maybeSingle();
    const { error } = await supabase.from("job_financials").upsert({ job_id: input.jobId, contract_amount: c, direct_costs: k, notes: input.notes?.slice(0, 500) || null, updated_by: profile.id, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: "No se pudo guardar." };
    // Trazabilidad: deja constancia del cambio en la bitácora del trabajo
    const fmt = (n: unknown) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US")}`);
    await supabase.from("activities").insert({ job_id: input.jobId, author_id: profile.id, kind: "sistema", body: `Finanzas: contrato ${fmt(prev?.contract_amount)} → ${fmt(c)}; costos ${fmt(prev?.direct_costs)} → ${fmt(k)}` });
    revalidatePath(`/trabajos/${input.jobId}`);
    return done("Finanzas guardadas.");
  } catch (e) { return fail(e); }
}

export async function addPayment(input: { jobId: string; amount: string; receivedOn: string; method: string; note: string }): Promise<R> {
  try {
    const { supabase, profile } = await admin();
    if (!isUuid(input.jobId)) return { ok: false, error: "Trabajo no válido." };
    const a = money(input.amount), d = date(input.receivedOn);
    if (a == null || Number.isNaN(a) || a === 0) return { ok: false, error: "Escribe el monto (negativo para corregir)." };
    if (!d) return { ok: false, error: "Escribe la fecha del pago." };
    // Evita el doble clic: mismo monto, fecha y trabajo en el último minuto
    const { data: dup } = await supabase.from("job_payments").select("id").eq("job_id", input.jobId).eq("amount", a).eq("received_on", d).gte("created_at", new Date(Date.now() - 60000).toISOString()).limit(1);
    if (dup?.length) return { ok: false, error: "Ese pago ya se registró hace un momento." };
    const { error } = await supabase.from("job_payments").insert({ job_id: input.jobId, amount: a, received_on: d, method: input.method?.slice(0, 40) || null, note: input.note?.slice(0, 300) || null, created_by: profile.id });
    if (error) return { ok: false, error: "No se pudo registrar el pago." };
    revalidatePath(`/trabajos/${input.jobId}`);
    return done(a < 0 ? "Corrección registrada." : "Pago registrado.");
  } catch (e) { return fail(e); }
}

export async function saveSplits(input: { jobId: string; rows: { userId: string; pct: string }[] }): Promise<R> {
  try {
    const { supabase } = await admin();
    if (!isUuid(input.jobId)) return { ok: false, error: "Trabajo no válido." };
    const rows = input.rows.filter((r) => isUuid(r.userId) && r.pct !== "").map((r) => ({ user_id: r.userId, share_pct: Number(r.pct) }));
    if (rows.some((r) => !(r.share_pct > 0 && r.share_pct <= 100))) return { ok: false, error: "Cada parte debe ser entre 0 y 100%." };
    if (new Set(rows.map((r) => r.user_id)).size !== rows.length) return { ok: false, error: "Un vendedor aparece dos veces." };
    const total = rows.reduce((a, r) => a + r.share_pct, 0);
    if (rows.length && Math.abs(total - 100) > 0.01) return { ok: false, error: `Las partes suman ${total}%; deben sumar 100%.` };
    await supabase.from("job_splits").delete().eq("job_id", input.jobId);
    if (rows.length) {
      const { error } = await supabase.from("job_splits").insert(rows.map((r) => ({ ...r, job_id: input.jobId })));
      if (error) return { ok: false, error: "No se pudo guardar la venta compartida." };
    }
    revalidatePath(`/trabajos/${input.jobId}`);
    return done(rows.length ? "Venta compartida guardada." : "La venta vuelve a ser 100% del vendedor del trabajo.");
  } catch (e) { return fail(e); }
}

/** Movimiento del libro de comisiones. "aprobada" guarda una foto del cálculo para que cambios futuros no la alteren. */
export async function addCommissionEntry(input: { userId: string; jobId: string; kind: string; amount: string; note: string }): Promise<R> {
  try {
    const { supabase, profile } = await admin();
    if (!isUuid(input.userId)) return { ok: false, error: "Vendedor no válido." };
    if (!["aprobada", "pago", "ajuste", "reverso"].includes(input.kind)) return { ok: false, error: "Tipo no válido." };
    const jobId = isUuid(input.jobId) ? input.jobId : null;
    let amount = money(input.amount);
    let basis: Record<string, unknown> | null = null;
    if (input.kind === "aprobada") {
      if (!jobId) return { ok: false, error: "Escoge el trabajo." };
      const d = await loadSales();
      const job = d.jobs.find((j) => j.id === jobId);
      if (!job) return { ok: false, error: "Trabajo no encontrado." };
      const share = sharesOf(job).find((s) => s.userId === input.userId)?.f ?? 0;
      if (!share) return { ok: false, error: "Ese vendedor no participa en este trabajo." };
      const signed = reachedAt(job, "contrato_firmado");
      if (!signed) return { ok: false, error: "El trabajo aún no tiene contrato firmado." };
      const plan = planAt(d.plans, input.userId, signed);
      const calc = commissionFor(job, plan, share);
      if (amount == null) amount = calc.amount;
      if (amount == null) return { ok: false, error: calc.reason || "No se pudo calcular; escribe el monto." };
      basis = { valor: saleValue(job), costos: job.costs, profit: grossProfit(job), parte: share, plan, calculada: calc.amount, firmado: signed, fecha: dayTX(new Date()) };
      const { data: dup } = await supabase.from("commission_entries").select("id").eq("job_id", jobId).eq("user_id", input.userId).eq("kind", "aprobada").limit(1);
      if (dup?.length && !input.note.trim()) return { ok: false, error: "Ya hay una comisión aprobada para este trabajo. Usa un ajuste, o escribe una nota explicando la nueva aprobación." };
    }
    if (amount == null || Number.isNaN(amount) || amount === 0) return { ok: false, error: "Escribe el monto." };
    if (input.kind === "reverso") amount = -Math.abs(amount);
    if (input.kind === "pago" && amount < 0) return { ok: false, error: "Un pago debe ser positivo; usa un ajuste para corregir." };
    if ((input.kind === "ajuste" || input.kind === "reverso") && !input.note.trim()) return { ok: false, error: "Explica el motivo en la nota." };
    const { error } = await supabase.from("commission_entries").insert({ user_id: input.userId, job_id: jobId, kind: input.kind, amount, basis, note: input.note?.slice(0, 500) || null, created_by: profile.id });
    if (error) return { ok: false, error: "No se pudo guardar el movimiento." };
    return done("Movimiento registrado.");
  } catch (e) { return fail(e); }
}

export async function saveGoal(input: { userId: string; month: string; metric: string; target: string }): Promise<R> {
  try {
    const { supabase } = await admin();
    const userId = isUuid(input.userId) ? input.userId : null;
    if (!/^\d{4}-\d{2}$/.test(input.month)) return { ok: false, error: "Escoge el mes." };
    if (!["volumen", "contratos", "aprobados", "inspecciones", "techos", "convertidos"].includes(input.metric)) return { ok: false, error: "Meta no válida." };
    const t = money(input.target);
    if (t == null || Number.isNaN(t) || t <= 0) return { ok: false, error: "La meta debe ser mayor que cero." };
    const month = `${input.month}-01`;
    let q = supabase.from("sales_goals").select("id").eq("month", month).eq("metric", input.metric);
    q = userId ? q.eq("user_id", userId) : q.is("user_id", null);
    const { data: ex } = await q.limit(1);
    const { error } = ex?.length
      ? await supabase.from("sales_goals").update({ target: t }).eq("id", ex[0].id)
      : await supabase.from("sales_goals").insert({ user_id: userId, month, metric: input.metric, target: t });
    if (error) return { ok: false, error: "No se pudo guardar la meta." };
    return done("Meta guardada.");
  } catch (e) { return fail(e); }
}

export async function deleteGoal(id: string): Promise<R> {
  try {
    const { supabase } = await admin();
    if (!isUuid(id)) return { ok: false, error: "Meta no válida." };
    const { error } = await supabase.from("sales_goals").delete().eq("id", id);
    return error ? { ok: false, error: "No se pudo borrar." } : done("Meta borrada.");
  } catch (e) { return fail(e); }
}

export async function saveSettings(input: { minSample: string; stalledDays: string }): Promise<R> {
  try {
    const { supabase } = await admin();
    const m = Number(input.minSample), s = Number(input.stalledDays);
    if (!Number.isInteger(m) || m < 1 || m > 100) return { ok: false, error: "Mínimo de leads: entre 1 y 100." };
    if (!Number.isInteger(s) || s < 1 || s > 365) return { ok: false, error: "Días para estancado: entre 1 y 365." };
    const { error } = await supabase.from("sales_settings").update({ min_sample: m, stalled_days: s, updated_at: new Date().toISOString() }).eq("id", 1);
    return error ? { ok: false, error: "No se pudo guardar." } : done("Ajustes guardados.");
  } catch (e) { return fail(e); }
}
