import "server-only";
import { todayTX } from "@/lib/format";
import {
  computeMetrics, dayTX, inP, ledger, MILESTONES, periodOf, previousPeriod, reachedAt, goalActual, goalPct,
  type Metrics, type Period, type SalesJob,
} from "@/lib/sales";
import { rankedReps, type SalesData } from "@/lib/sales-server";

export type Filters = { p: string; from?: string; to?: string; terr?: string; src?: string; ant?: string };
export const SRC_GROUPS = [["", "Todos los orígenes"], ["propio", "Propios (puerta a puerta, referidos)"], ["empresa", "De la empresa (comprados, web)"], ["otro", "Otros"]] as const;
export const ANT_GROUPS = [["", "Cualquier antigüedad"], ["nuevo", "Menos de 6 meses"], ["medio", "6 a 12 meses"], ["veterano", "Más de 1 año"]] as const;

export function readFilters(sp: Record<string, string | undefined>): Filters {
  return { p: sp.p ?? "mes", from: sp.from, to: sp.to, terr: sp.terr || undefined, src: sp.src || undefined, ant: sp.ant || undefined };
}

/** Oculta comisión y profit cuando quien mira no tiene permiso para esos datos. */
export function maskMoney(m: Metrics, allowed: boolean): Metrics {
  return allowed ? m : { ...m, commission: null, grossProfit: null, commissionMissing: 0 };
}

export function buildView(d: SalesData, f: Filters) {
  const today = todayTX();
  const period = periodOf(f.p, today, f.from, f.to);
  const prev = previousPeriod(period);
  const srcOk = (j: SalesJob) => !f.src ? true
    : f.src === "propio" ? ["door_to_door", "referido"].includes(j.source ?? "")
    : f.src === "empresa" ? ["lead_comprado", "web"].includes(j.source ?? "")
    : !["door_to_door", "referido", "lead_comprado", "web"].includes(j.source ?? "");
  const jobs = d.jobs.filter((j) => (!f.terr || j.territoryId === f.terr) && srcOk(j));
  const jobIds = new Set(jobs.map((j) => j.id));
  const appts = d.appts.filter((a) => !a.jobId || jobIds.has(a.jobId));
  const payments = d.payments.filter((p) => jobIds.has(p.jobId));
  const base = { jobs, appts, payments, plans: d.plans, minSample: d.settings.minSample };

  const monthsSince = (date: string | null) => (date ? (Date.parse(today) - Date.parse(date)) / (30.44 * 86400000) : null);
  const antOk = (hire: string | null, created: string) => {
    if (!f.ant) return true;
    const m = monthsSince(hire ?? created.slice(0, 10));
    return m == null ? false : f.ant === "nuevo" ? m < 6 : f.ant === "medio" ? m >= 6 && m <= 12 : m > 12;
  };
  const reps = rankedReps(d).filter((r) => antOk(r.hireDate, r.createdAt));
  const curMonth = today.slice(0, 7);
  const rows = reps.map((r) => {
    const m = computeMetrics({ ...base, period, userId: r.id });
    const pm = computeMetrics({ ...base, period: prev, userId: r.id });
    const money = d.access.canSeeMoneyOf(r.id);
    const goal = d.goals.find((g) => g.userId === r.id && g.month === curMonth && g.metric === "volumen")
      ?? d.goals.find((g) => g.userId === r.id && g.month === curMonth);
    // La meta se mide contra el mes en curso (no contra el filtro), para que el % sea comparable
    const mMonth = goal ? computeMetrics({ ...base, period: { from: `${curMonth}-01`, to: today }, userId: r.id }) : null;
    const actual = goal && mMonth ? goalActual(goal.metric, mMonth) : null;
    return {
      id: r.id, name: r.name, role: r.role, active: r.active, canOpen: d.access.canSeeRep(r.id),
      m: maskMoney(m, money), prev: maskMoney(pm, money),
      goal: goal ? { metric: goal.metric, target: goal.target, actual, pct: goalPct(actual, goal.target) } : null,
    };
  });
  const team = computeMetrics({ ...base, period });
  const teamPrev = computeMetrics({ ...base, period: prev });
  return { today, period, prev, jobs, appts, payments, base, rows, team, teamPrev };
}

// ---------------- Línea de tiempo ----------------
const EVENT_OF: Record<string, string> = {
  [MILESTONES.inspeccion]: "Inspección completada", [MILESTONES.aprobado]: "Reclamo aprobado", [MILESTONES.firmado]: "Contrato firmado",
  [MILESTONES.techo]: "Proyecto terminado (facturado)", completado: "Proyecto completado", denegado: "Reclamo denegado", perdido: "Trabajo perdido",
};
export type TimelineItem = { at: string; label: string; repId: string | null; jobId: string | null; jobLabel: string | null; amount: number | null; icon: string };
export function timeline(d: SalesData, jobs: SalesJob[], period: Period, onlyRep?: string, limit = 50): TimelineItem[] {
  const out: TimelineItem[] = [];
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const visible = (j: SalesJob) => d.canSeeJob(j.id);
  for (const j of jobs) {
    if (onlyRep && j.repId !== onlyRep && !j.splits?.some((s) => s.userId === onlyRep)) continue;
    const lbl = visible(j) ? `#${j.number} · ${j.name}` : `Trabajo #${j.number}`;
    if (inP(dayTX(j.createdAt), period)) out.push({ at: j.createdAt, label: "Nuevo lead asignado", repId: j.repId, jobId: visible(j) ? j.id : null, jobLabel: lbl, amount: null, icon: "plus" });
    const seen = new Set<string>();
    for (const h of j.history) {
      const ev = EVENT_OF[h.to];
      if (!ev || seen.has(h.to) || !inP(dayTX(h.at), period)) continue;
      seen.add(h.to);
      out.push({ at: h.at, label: ev, repId: j.repId, jobId: visible(j) ? j.id : null, jobLabel: lbl, amount: null, icon: h.to === MILESTONES.firmado ? "check" : h.to === "denegado" || h.to === "perdido" ? "x" : "activity" });
    }
  }
  for (const p of d.paymentsRaw) {
    const j = byId.get(p.job_id); if (!j || !inP(p.received_on, period)) continue;
    if (onlyRep && j.repId !== onlyRep) continue;
    if (!d.access.staff && !d.canSeeJob(j.id)) continue; // montos de clientes ajenos no se muestran
    out.push({ at: `${p.received_on}T18:00:00Z`, label: Number(p.amount) < 0 ? "Corrección de pago" : "Pago recibido", repId: j.repId, jobId: d.canSeeJob(j.id) ? j.id : null, jobLabel: `#${j.number} · ${j.name}`, amount: Number(p.amount), icon: "dollar" });
  }
  for (const e of d.entriesRaw) {
    if (e.kind !== "pago" || !inP(dayTX(e.created_at), period)) continue;
    if (!d.access.canSeeMoneyOf(e.user_id) || (onlyRep && e.user_id !== onlyRep)) continue;
    const j = e.job_id ? byId.get(e.job_id) : null;
    out.push({ at: e.created_at, label: "Comisión pagada", repId: e.user_id, jobId: j && d.canSeeJob(j.id) ? j.id : null, jobLabel: j ? `#${j.number}` : null, amount: Number(e.amount), icon: "dollar" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export function repLedger(d: SalesData, userId: string) {
  if (!d.access.canSeeMoneyOf(userId)) return null;
  return { ...ledger(d.entries, userId), entries: d.entriesRaw.filter((e) => e.user_id === userId) };
}

/** Trabajos que respaldan un indicador (solo los que el usuario puede abrir). */
export function backingJobs(d: SalesData, jobs: SalesJob[], period: Period, userId: string) {
  const mine = jobs.filter((j) => (j.splits?.length ? j.splits.some((s) => s.userId === userId) : j.repId === userId));
  const pick = (fn: (j: SalesJob) => boolean) => mine.filter(fn).map((j) => ({ id: j.id, number: j.number, name: d.canSeeJob(j.id) ? j.name : null, status: j.status, open: d.canSeeJob(j.id) }));
  return {
    firmados: pick((j) => inP(reachedAt(j, MILESTONES.firmado), period)),
    aprobados: pick((j) => j.jobType !== "retail" && inP(reachedAt(j, MILESTONES.aprobado), period)),
    techos: pick((j) => inP(reachedAt(j, MILESTONES.techo), period)),
    leads: pick((j) => inP(dayTX(j.createdAt), period)),
  };
}
