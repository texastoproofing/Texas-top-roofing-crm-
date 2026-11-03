import "server-only";
import { getSession, type Profile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appt, Entry, Payment, Plan, SalesJob } from "@/lib/sales";

// Quién ve qué (se aplica en el servidor antes de enviar datos al navegador; las tablas también tienen RLS)
export type Access = {
  me: Profile;
  admin: boolean;                 // todo, incluidos costos, profit y comisiones de todos
  staff: boolean;                 // PM / asistente / admin: ven todos los trabajos (sin finanzas si no es admin)
  team: Set<string>;              // vendedores cuyo detalle puede ver (él mismo + su equipo si es supervisor)
  canSeeRep: (id: string) => boolean;
  canSeeMoneyOf: (id: string) => boolean; // comisiones y profit
};

export type RepInfo = { id: string; name: string; role: string; active: boolean; email: string | null; hireDate: string | null; supervisorId: string | null; territoryId: string | null; createdAt: string };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const num = (v: unknown) => (v == null ? null : Number(v));

export async function loadSales() {
  const { profile } = await getSession(); // exige sesión activa antes de usar la llave de servicio
  const db = createAdminClient();
  const [profilesR, repR, jobsR, histR, finR, splitR, apptR, payR, planR, entryR, goalR, setR, terrR] = await Promise.all([
    db.from("profiles").select("id, full_name, role, active, email, created_at").order("full_name"),
    db.from("rep_profiles").select("user_id, hire_date, supervisor_id, territory_id"),
    db.from("jobs").select("id, number, name, status, job_type, sales_rep_id, pm_id, created_by, created_at, territory_id, estimate_amount, approved_amount, contact:contacts(source)").limit(10000),
    db.from("job_status_history").select("job_id, to_status, changed_at").order("changed_at").limit(50000),
    db.from("job_financials").select("job_id, contract_amount, direct_costs"),
    db.from("job_splits").select("job_id, user_id, share_pct"),
    db.from("appointments").select("job_id, kind, starts_at, created_at, assigned_to").limit(20000),
    db.from("job_payments").select("id, job_id, amount, received_on, method, note, created_at").order("received_on").limit(20000),
    db.from("commission_plans").select("id, user_id, model, profit_pct, sales_pct, fixed_amount, valid_from, valid_to, notes").order("valid_from", { ascending: false }),
    db.from("commission_entries").select("id, job_id, user_id, kind, amount, basis, note, created_at, created_by").order("created_at", { ascending: false }).limit(20000),
    db.from("sales_goals").select("id, user_id, month, metric, target"),
    db.from("sales_settings").select("min_sample, stalled_days").eq("id", 1).maybeSingle(),
    db.from("territories").select("id, code, name").order("priority"),
  ]);
  const missing = [histR, finR, planR, entryR, goalR].some((r) => r.error);

  const rp = new Map(((repR.data ?? []) as any[]).map((r) => [r.user_id, r]));
  const reps: RepInfo[] = ((profilesR.data ?? []) as any[]).map((p) => ({
    id: p.id, name: p.full_name || p.email || "Sin nombre", role: p.role, active: p.active, email: p.email, createdAt: p.created_at,
    hireDate: rp.get(p.id)?.hire_date ?? null, supervisorId: rp.get(p.id)?.supervisor_id ?? null, territoryId: rp.get(p.id)?.territory_id ?? null,
  }));

  const hist = new Map<string, { to: string; at: string }[]>();
  for (const h of (histR.data ?? []) as any[]) { if (!hist.has(h.job_id)) hist.set(h.job_id, []); hist.get(h.job_id)!.push({ to: h.to_status, at: h.changed_at }); }
  const fin = new Map(((finR.data ?? []) as any[]).map((f) => [f.job_id, f]));
  const splits = new Map<string, { userId: string; pct: number }[]>();
  for (const s of (splitR.data ?? []) as any[]) { if (!splits.has(s.job_id)) splits.set(s.job_id, []); splits.get(s.job_id)!.push({ userId: s.user_id, pct: Number(s.share_pct) }); }

  const rawJobs = (jobsR.data ?? []) as any[];
  const jobs: SalesJob[] = rawJobs.map((j) => ({
    id: j.id, number: j.number, name: j.name, status: j.status, repId: j.sales_rep_id, createdAt: j.created_at,
    source: one<any>(j.contact)?.source ?? null, territoryId: j.territory_id, jobType: j.job_type,
    estimate: num(j.estimate_amount), approved: num(j.approved_amount),
    contract: num(fin.get(j.id)?.contract_amount), costs: num(fin.get(j.id)?.direct_costs),
    history: hist.get(j.id) ?? [], splits: splits.get(j.id),
  }));
  const jobAccess = new Map(rawJobs.map((j) => [j.id, [j.sales_rep_id, j.pm_id, j.created_by].filter(Boolean) as string[]]));

  const appts: Appt[] = ((apptR.data ?? []) as any[]).map((a) => ({ jobId: a.job_id, kind: a.kind, startsAt: a.starts_at, createdAt: a.created_at, assignedTo: a.assigned_to }));
  const paymentsRaw = (payR.data ?? []) as any[];
  const payments: Payment[] = paymentsRaw.map((p) => ({ jobId: p.job_id, amount: Number(p.amount), receivedOn: p.received_on }));
  const plansRaw = (planR.data ?? []) as any[];
  const plans: Plan[] = plansRaw.map((p) => ({ userId: p.user_id, model: p.model, profitPct: num(p.profit_pct), salesPct: num(p.sales_pct), fixed: num(p.fixed_amount), from: p.valid_from, to: p.valid_to }));
  const entriesRaw = (entryR.data ?? []) as any[];
  const entries: Entry[] = entriesRaw.map((e) => ({ userId: e.user_id, jobId: e.job_id, kind: e.kind, amount: Number(e.amount), at: e.created_at }));

  // ---- Permisos ----
  const admin = profile.role === "administrador";
  const staff = profile.role !== "vendedor";
  const reports = reps.filter((r) => r.supervisorId === profile.id).map((r) => r.id);
  const team = new Set<string>([profile.id, ...reports]);
  const access: Access = {
    me: profile, admin, staff, team,
    canSeeRep: (id) => staff || team.has(id),
    canSeeMoneyOf: (id) => admin || id === profile.id,
  };
  const canSeeJob = (jobId: string) => staff || (jobAccess.get(jobId) ?? []).some((u) => team.has(u));

  return {
    access, reps, jobs, appts, payments, plans, entries, missing, canSeeJob,
    paymentsRaw, plansRaw, entriesRaw,
    goals: ((goalR.data ?? []) as any[]).map((g) => ({ id: g.id as string, userId: g.user_id as string | null, month: String(g.month).slice(0, 7), metric: g.metric as string, target: Number(g.target) })),
    settings: { minSample: setR.data?.min_sample ?? 5, stalledDays: setR.data?.stalled_days ?? 14 },
    territories: (terrR.data ?? []) as { id: string; code: string; name: string }[],
  };
}
export type SalesData = Awaited<ReturnType<typeof loadSales>>;

/** Vendedores que aparecen en el ranking: rol vendedor, o cualquiera con trabajos asignados. */
export function rankedReps(d: SalesData) {
  const withJobs = new Set(d.jobs.flatMap((j) => (j.splits?.length ? j.splits.map((s) => s.userId) : j.repId ? [j.repId] : [])));
  return d.reps.filter((r) => r.role === "vendedor" || withJobs.has(r.id));
}
