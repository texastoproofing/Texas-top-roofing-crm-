// Sales Performance: reglas de KPI, atribución, rankings, embudo, comisiones y reconocimientos.
// Funciones puras (se prueban en tests/sales.test.ts). Fechas en hora de Texas (America/Chicago).

export const TZ = "America/Chicago";
export const dayTX = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

// Orden del pipeline existente (lib/constants STATUSES) — no se crean estados nuevos
export const PIPELINE = [
  "lead_nuevo", "contactado", "inspeccion_agendada", "inspeccionado", "reclamo_abierto", "ajustador", "desk_adjuster",
  "estimado_enviado", "aprobado", "contrato_firmado", "suplemento", "materiales", "instalacion_agendada", "en_instalacion",
  "facturado", "pago_parcial", "completado",
] as const;
export const CLOSED_LOST = ["perdido", "denegado"];
const idx = (s: string) => PIPELINE.indexOf(s as any);

// Hitos del embudo mapeados al pipeline existente
export const MILESTONES = {
  cita: "inspeccion_agendada",
  inspeccion: "inspeccionado",
  reclamo: "reclamo_abierto",
  aprobado: "aprobado",
  firmado: "contrato_firmado",
  techo: "facturado",
} as const;

export type Hist = { to: string; at: string };
export type SalesJob = {
  id: string; number: number; name: string; status: string; repId: string | null; createdAt: string;
  source: string | null; territoryId: string | null; jobType?: "seguro" | "retail";
  estimate: number | null; approved: number | null; contract: number | null; costs: number | null;
  history: Hist[]; splits?: { userId: string; pct: number }[];
};
export type Appt = { jobId: string | null; kind: string; startsAt: string; createdAt: string; assignedTo: string | null };
export type Payment = { jobId: string; amount: number; receivedOn: string };
export type Plan = { userId: string; model: "profit_pct" | "sales_pct" | "fixed" | "mixed"; profitPct: number | null; salesPct: number | null; fixed: number | null; from: string; to: string | null };
export type Entry = { userId: string; jobId: string | null; kind: "aprobada" | "pago" | "ajuste" | "reverso"; amount: number; at: string };
export type Period = { from: string; to: string };

// ---------------- Dinero: redondeo a centavos sin errores de coma flotante ----------------
export const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const sumC = (xs: number[]) => cents(xs.reduce((a, b) => a + Math.round(b * 100), 0) / 100);
export const rate = (num: number, den: number) => (den > 0 ? num / den : null);

// ---------------- Períodos ----------------
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
export const PRESETS = [["hoy", "Hoy"], ["semana", "Esta semana"], ["mes", "Este mes"], ["30d", "Últimos 30 días"], ["trimestre", "Este trimestre"], ["ano", "Este año"], ["custom", "Personalizado"]] as const;
export function periodOf(preset: string, today: string, from?: string, to?: string): Period {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "hoy": return { from: today, to: today };
    case "semana": { const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; return { from: addDays(today, -dow), to: today }; }
    case "30d": return { from: addDays(today, -29), to: today };
    case "trimestre": { const qm = Math.floor((m - 1) / 3) * 3 + 1; return { from: `${y}-${String(qm).padStart(2, "0")}-01`, to: today }; }
    case "ano": return { from: `${y}-01-01`, to: today };
    case "custom": if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) return from <= to ? { from, to } : { from: to, to: from };
    // fallthrough
    default: return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: today };
  }
}
/** Período anterior comparable (misma cantidad de días, justo antes). */
export function previousPeriod(p: Period): Period {
  const len = daysBetween(p.from, p.to);
  const to = addDays(p.from, -1);
  return { from: addDays(to, -len), to };
}
export const inP = (day: string | null | undefined, p: Period) => !!day && day >= p.from && day <= p.to;

// ---------------- Hitos por trabajo ----------------
/** Primera fecha (TX) en que el trabajo llegó a `status` o a una etapa posterior (sin contar perdido/denegado). */
export function reachedAt(job: SalesJob, status: string): string | null {
  const target = idx(status);
  let best: string | null = null;
  for (const h of job.history) {
    const i = idx(h.to);
    if (i >= target && i >= 0 && (!best || h.at < best)) best = h.at;
  }
  // Respaldo: si el estado actual ya pasó la etapa y no hay historial
  if (!best && idx(job.status) >= target) best = job.history.length ? job.history[job.history.length - 1].at : job.createdAt;
  return best ? dayTX(best) : null;
}
export const deniedAt = (job: SalesJob) => { const h = job.history.filter((x) => x.to === "denegado").map((x) => x.at).sort()[0]; return h ? dayTX(h) : job.status === "denegado" ? dayTX(job.createdAt) : null; };
export const isCancelled = (job: SalesJob) => CLOSED_LOST.includes(job.status);
/** Valor de venta: contrato; si no hay, monto aprobado. Nunca el estimado (no es una venta). */
export function saleValue(job: SalesJob): { value: number | null; from: "contrato" | "aprobado" | null } {
  if (job.contract != null) return { value: job.contract, from: "contrato" };
  if (job.approved != null) return { value: job.approved, from: "aprobado" };
  return { value: null, from: null };
}
export const grossProfit = (job: SalesJob) => { const v = saleValue(job).value; return v != null && job.costs != null ? cents(v - job.costs) : null; };
export function sharesOf(job: SalesJob): { userId: string; f: number }[] {
  if (job.splits?.length) return job.splits.map((s) => ({ userId: s.userId, f: s.pct / 100 }));
  return job.repId ? [{ userId: job.repId, f: 1 }] : [];
}

// ---------------- Comisiones ----------------
export function planAt(plans: Plan[], userId: string, day: string): Plan | null {
  return plans.filter((p) => p.userId === userId && p.from <= day && (!p.to || p.to >= day)).sort((a, b) => b.from.localeCompare(a.from))[0] ?? null;
}
/** Comisión estimada de un trabajo para un plan. null si faltan datos (p. ej. % del profit sin costos). */
export function commissionFor(job: SalesJob, plan: Plan | null, share = 1): { amount: number | null; reason: string } {
  if (!plan) return { amount: null, reason: "Sin plan de comisión" };
  const v = saleValue(job).value, gp = grossProfit(job);
  const parts: number[] = [];
  if (plan.model === "profit_pct" || plan.model === "mixed") {
    if (plan.profitPct != null) { if (gp == null) return { amount: null, reason: "Faltan costos para calcular el profit" }; parts.push(gp * plan.profitPct / 100); }
  }
  if (plan.model === "sales_pct" || plan.model === "mixed") {
    if (plan.salesPct != null) { if (v == null) return { amount: null, reason: "Falta el valor del contrato" }; parts.push(v * plan.salesPct / 100); }
  }
  if (plan.model === "fixed" || plan.model === "mixed") if (plan.fixed != null) parts.push(plan.fixed);
  if (!parts.length) return { amount: null, reason: "Plan incompleto" };
  return { amount: cents(parts.reduce((a, b) => a + b, 0) * share), reason: "" };
}
export function ledger(entries: Entry[], userId?: string) {
  const e = userId ? entries.filter((x) => x.userId === userId) : entries;
  const s = (k: Entry["kind"]) => sumC(e.filter((x) => x.kind === k).map((x) => x.amount));
  const approved = s("aprobada"), paid = s("pago"), adj = s("ajuste"), rev = s("reverso");
  return { approved, paid, adjustments: adj, reversals: rev, pending: cents(approved + adj - Math.abs(rev) - paid) };
}

// ---------------- Métricas por vendedor / equipo ----------------
export const OWN_SOURCES = ["door_to_door", "referido"];
export const PAID_SOURCES = ["lead_comprado", "web"];

export type Metrics = {
  leads: number; ownLeads: number; companyLeads: number;
  appointments: number; apptsDone: number; inspections: number;
  signed: number; signedValue: number | null; valueFrom: string[];
  approvedClaims: number; approvedValue: number | null; denied: number; completed: number;
  collected: number | null; cancelled: number;
  conversion: number | null; conversionSample: number; conversionEligible: boolean;
  avgDeal: number | null; grossProfit: number | null; commission: number | null; commissionMissing: number;
  leadToSaleDays: number | null; leadToSaleSample: number; firstSigned: string | null;
};

export function computeMetrics(args: {
  jobs: SalesJob[]; appts: Appt[]; payments: Payment[]; plans: Plan[]; period: Period; minSample: number;
  userId?: string; // sin userId = equipo completo (cada trabajo cuenta una vez)
  now?: string;
}): Metrics {
  const { jobs, period: p, userId } = args;
  const now = args.now ?? new Date().toISOString();
  const shareOf = (j: SalesJob) => (userId ? sharesOf(j).find((s) => s.userId === userId)?.f ?? 0 : 1);
  const mine = jobs.map((j) => ({ j, f: shareOf(j) })).filter((x) => x.f > 0);
  const r1 = (n: number) => Math.round(n * 100) / 100;

  let leads = 0, own = 0, company = 0, insp = 0, signed = 0, appr = 0, denied = 0, done = 0, canc = 0;
  const values: number[] = [], apprValues: number[] = [], profits: number[] = [], comms: number[] = [];
  const from = new Set<string>(); let commMissing = 0; let firstSigned: string | null = null;
  const cohort = { n: 0, won: 0 }; const l2s: number[] = [];
  for (const { j, f } of mine) {
    const created = dayTX(j.createdAt);
    if (inP(created, p)) {
      leads += f;
      if (j.source && OWN_SOURCES.includes(j.source)) own += f; else if (j.source && PAID_SOURCES.includes(j.source)) company += f;
      cohort.n += f;
      if (reachedAt(j, MILESTONES.firmado) && !isCancelled(j)) cohort.won += f;
    }
    if (inP(reachedAt(j, MILESTONES.inspeccion), p)) insp += f;
    const sDay = reachedAt(j, MILESTONES.firmado);
    if (inP(sDay, p)) {
      if (isCancelled(j)) canc += f;
      else {
        signed += f;
        if (!firstSigned || sDay! < firstSigned) firstSigned = sDay;
        const sv = saleValue(j);
        if (sv.value != null) { values.push(sv.value * f); from.add(sv.from!); }
        const gp = grossProfit(j); if (gp != null) profits.push(gp * f);
        l2s.push(daysBetween(created, sDay!));
        if (userId) {
          const c = commissionFor(j, planAt(args.plans, userId, sDay!), f);
          if (c.amount != null) comms.push(c.amount); else commMissing++;
        } else {
          for (const s of sharesOf(j)) { const c = commissionFor(j, planAt(args.plans, s.userId, sDay!), s.f); if (c.amount != null) comms.push(c.amount); else commMissing++; }
        }
      }
    }
    // Reclamo aprobado: solo trabajos de seguro (un retail no tiene reclamo)
    if (j.jobType !== "retail" && inP(reachedAt(j, MILESTONES.aprobado), p) && j.status !== "denegado") { appr += f; if (j.approved != null) apprValues.push(j.approved * f); }
    if (inP(deniedAt(j), p)) denied += f;
    if (inP(reachedAt(j, MILESTONES.techo), p) && !isCancelled(j)) done += f;
  }
  const jobShare = new Map(mine.map(({ j, f }) => [j.id, f]));
  const ap = args.appts.filter((a) => (userId ? a.assignedTo === userId : true) && inP(dayTX(a.createdAt), p));
  const apDone = args.appts.filter((a) => (userId ? a.assignedTo === userId : true) && inP(dayTX(a.startsAt), p) && a.startsAt <= now);
  const pays = args.payments.filter((x) => jobShare.has(x.jobId) && inP(x.receivedOn, p));
  const signedValue = values.length ? sumC(values) : null;
  const sortedL2s = [...l2s].sort((a, b) => a - b);
  return {
    leads: r1(leads), ownLeads: r1(own), companyLeads: r1(company),
    appointments: ap.length, apptsDone: apDone.length, inspections: r1(insp),
    signed: r1(signed), signedValue, valueFrom: [...from],
    approvedClaims: r1(appr), approvedValue: apprValues.length ? sumC(apprValues) : null, denied: r1(denied), completed: r1(done),
    collected: pays.length ? sumC(pays.map((x) => x.amount * (jobShare.get(x.jobId) ?? 0))) : null, cancelled: r1(canc),
    conversion: rate(cohort.won, cohort.n), conversionSample: r1(cohort.n), conversionEligible: cohort.n >= args.minSample,
    avgDeal: signedValue != null && values.length ? cents(signedValue / values.length) : null,
    grossProfit: profits.length ? sumC(profits) : null,
    commission: comms.length ? sumC(comms) : null, commissionMissing: commMissing,
    leadToSaleDays: sortedL2s.length ? sortedL2s[Math.floor((sortedL2s.length - 1) / 2)] : null,
    leadToSaleSample: sortedL2s.length, firstSigned,
  };
}

/** Variación contra el período anterior. null si no hay base para comparar. */
export function delta(cur: number | null, prev: number | null, kind: "pct" | "pp" = "pct") {
  if (cur == null || prev == null) return null;
  if (kind === "pp") return { value: cents((cur - prev) * 100), unit: "pp" as const };
  if (prev === 0) return cur === 0 ? { value: 0, unit: "%" as const } : null;
  return { value: cents(((cur - prev) / Math.abs(prev)) * 100), unit: "%" as const };
}

// ---------------- Rankings ----------------
export const RANKINGS = [
  { key: "volumen", label: "Volumen de ventas", metric: (m: Metrics) => m.signedValue, dir: -1, fin: false },
  { key: "contratos", label: "Más contratos", metric: (m: Metrics) => m.signed, dir: -1, fin: false },
  { key: "aprobados", label: "Más reclamos aprobados", metric: (m: Metrics) => m.approvedClaims, dir: -1, fin: false },
  { key: "conversion", label: "Mejor conversión", metric: (m: Metrics) => (m.conversionEligible ? m.conversion : null), dir: -1, fin: false },
  { key: "techos", label: "Más techos completados", metric: (m: Metrics) => m.completed, dir: -1, fin: false },
  { key: "profit", label: "Mayor profit bruto", metric: (m: Metrics) => m.grossProfit, dir: -1, fin: true },
  { key: "citas", label: "Más citas agendadas", metric: (m: Metrics) => m.appointments, dir: -1, fin: false },
  { key: "rapidez", label: "Lead a venta más rápido", metric: (m: Metrics) => (m.leadToSaleSample >= 1 ? m.leadToSaleDays : null), dir: 1, fin: false },
] as const;
export type RankKey = (typeof RANKINGS)[number]["key"];
export const TIE_RULE = "Empates: gana quien tenga más contratos; si siguen iguales, quien firmó primero; luego por nombre.";

export function rank<T extends { name: string; m: Metrics }>(rows: T[], key: RankKey): (T & { pos: number | null; value: number | null })[] {
  const R = RANKINGS.find((r) => r.key === key)!;
  const withV = rows.map((r) => ({ ...r, value: R.metric(r.m) as number | null }));
  const ranked = withV.filter((r) => r.value != null && (key === "rapidez" || r.value !== 0))
    .sort((a, b) => R.dir * (b.value! - a.value!) * -1 || b.m.signed - a.m.signed || (a.m.firstSigned ?? "9").localeCompare(b.m.firstSigned ?? "9") || a.name.localeCompare(b.name));
  const rest = withV.filter((r) => !ranked.includes(r)).sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked.map((r, i) => ({ ...r, pos: i + 1 })), ...rest.map((r) => ({ ...r, pos: null }))];
}

// ---------------- Embudo ----------------
export const FUNNEL = [
  { key: "lead", label: "Lead" }, { key: "cita", label: "Cita agendada" }, { key: "inspeccion", label: "Inspección" },
  { key: "reclamo", label: "Reclamo abierto" }, { key: "aprobado", label: "Reclamo aprobado" }, { key: "firmado", label: "Contrato firmado" },
  { key: "techo", label: "Techo completado" }, { key: "cobrado", label: "Pago cobrado" },
] as const;
export function funnel(args: { jobs: SalesJob[]; appts: Appt[]; payments: Payment[]; period: Period; userId?: string; stalledDays: number; today: string }) {
  const cohort = args.jobs.filter((j) => inP(dayTX(j.createdAt), args.period) && (!args.userId || sharesOf(j).some((s) => s.userId === args.userId)));
  const firstAppt = new Map<string, string>();
  for (const a of args.appts) if (a.jobId) { const d = dayTX(a.createdAt); if (!firstAppt.has(a.jobId) || d < firstAppt.get(a.jobId)!) firstAppt.set(a.jobId, d); }
  const paidOn = new Map<string, string>();
  for (const p of [...args.payments].sort((a, b) => a.receivedOn.localeCompare(b.receivedOn))) if (p.amount > 0 && !paidOn.has(p.jobId)) paidOn.set(p.jobId, p.receivedOn);
  const dates = (j: SalesJob): Record<string, string | null> => {
    const r = reachedAt(j, MILESTONES.cita), fa = firstAppt.get(j.id) ?? null;
    return {
      lead: dayTX(j.createdAt), cita: [r, fa].filter(Boolean).sort()[0] ?? null, inspeccion: reachedAt(j, MILESTONES.inspeccion),
      reclamo: reachedAt(j, MILESTONES.reclamo), aprobado: reachedAt(j, MILESTONES.aprobado), firmado: reachedAt(j, MILESTONES.firmado),
      techo: reachedAt(j, MILESTONES.techo), cobrado: paidOn.get(j.id) ?? null,
    };
  };
  const all = cohort.map((j) => ({ j, d: dates(j) }));
  const stages = FUNNEL.map((s, i) => {
    const n = all.filter((x) => x.d[s.key]).length;
    const prevKey = i > 0 ? FUNNEL[i - 1].key : null;
    const prevN = prevKey ? all.filter((x) => x.d[prevKey]).length : n;
    const gaps = prevKey ? all.filter((x) => x.d[prevKey] && x.d[s.key]).map((x) => daysBetween(x.d[prevKey]!, x.d[s.key]!)) : [];
    return {
      ...s, n, fromPrev: i ? rate(n, prevN) : null, cumulative: rate(n, all.length),
      avgDays: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
    };
  });
  const lastChange = (j: SalesJob) => j.history.map((h) => h.at).sort().reverse()[0] ?? j.createdAt;
  const stalled = cohort.filter((j) => !isCancelled(j) && idx(j.status) < idx("completado") && daysBetween(dayTX(lastChange(j)), args.today) >= args.stalledDays)
    .map((j) => ({ id: j.id, number: j.number, name: j.name, status: j.status, days: daysBetween(dayTX(lastChange(j)), args.today) }))
    .sort((a, b) => b.days - a.days);
  const approvedN = all.filter((x) => x.d.aprobado && x.j.status !== "denegado").length;
  const deniedN = cohort.filter((j) => deniedAt(j)).length;
  const bySource = (srcs: string[]) => { const c = cohort.filter((j) => j.source && srcs.includes(j.source)); return { n: c.length, won: c.filter((j) => reachedAt(j, MILESTONES.firmado) && !isCancelled(j)).length }; };
  return { total: cohort.length, stages, stalled, rejectionRate: rate(deniedN, approvedN + deniedN), denied: deniedN, own: bySource(OWN_SOURCES), paid: bySource(PAID_SOURCES) };
}

// ---------------- Tendencia mensual ----------------
export function monthsBack(today: string, n: number) {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)); return d.toISOString().slice(0, 7); });
}
export function monthlySeries(jobs: SalesJob[], months: string[], userId?: string) {
  return months.map((mo) => {
    let count = 0; const vals: number[] = [];
    for (const j of jobs) {
      if (isCancelled(j)) continue;
      const f = userId ? sharesOf(j).find((s) => s.userId === userId)?.f ?? 0 : 1;
      const d = reachedAt(j, MILESTONES.firmado);
      if (!f || !d || d.slice(0, 7) !== mo) continue;
      count += f; const v = saleValue(j).value; if (v != null) vals.push(v * f);
    }
    return { month: mo, signed: Math.round(count * 100) / 100, value: vals.length ? sumC(vals) : null };
  });
}

// ---------------- Metas ----------------
export const GOAL_METRICS = [
  ["volumen", "Volumen de ventas ($)"], ["contratos", "Contratos firmados"], ["aprobados", "Reclamos aprobados"],
  ["inspecciones", "Inspecciones"], ["techos", "Techos completados"], ["convertidos", "Leads convertidos"],
] as const;
export function goalActual(metric: string, m: Metrics) {
  switch (metric) {
    case "volumen": return m.signedValue;
    case "contratos": return m.signed;
    case "aprobados": return m.approvedClaims;
    case "inspecciones": return m.inspections;
    case "techos": return m.completed;
    case "convertidos": return m.signed;
    default: return null;
  }
}
export const goalPct = (actual: number | null, target: number) => (actual == null || target <= 0 ? null : Math.round((actual / target) * 1000) / 10);

// ---------------- Reconocimientos (criterios publicados) ----------------
export function awards<T extends { id: string; name: string; m: Metrics; prev: Metrics }>(rows: T[]) {
  const top = (key: RankKey) => rank(rows, key)[0];
  const out: { key: string; title: string; who: string | null; id: string | null; detail: string; rule: string }[] = [];
  const v = top("volumen"), c = top("contratos");
  const seller = v?.pos ? { r: v, d: `$${Math.round(v.value!).toLocaleString("en-US")}` } : c?.pos ? { r: c, d: `${c.value} contratos` } : null;
  out.push({ key: "top", title: "Mejor vendedor", who: seller?.r.name ?? null, id: seller?.r.id ?? null, detail: seller?.d ?? "Sin ventas en el período", rule: "Mayor volumen vendido (contratos firmados no cancelados); si no hay montos, más contratos." });
  const improved = rows.map((r) => ({ r, d: (r.m.signedValue ?? 0) - (r.prev.signedValue ?? 0), dc: r.m.signed - r.prev.signed }))
    .filter((x) => x.d > 0 || (x.d === 0 && x.dc > 0)).sort((a, b) => b.d - a.d || b.dc - a.dc)[0];
  out.push({ key: "mejora", title: "Mayor mejora", who: improved?.r.name ?? null, id: improved?.r.id ?? null, detail: improved ? (improved.d > 0 ? `+$${Math.round(improved.d).toLocaleString("en-US")} vs. período anterior` : `+${improved.dc} contratos vs. período anterior`) : "Nadie mejoró frente al período anterior", rule: "Mayor aumento de volumen (o de contratos) contra el período anterior comparable." });
  const conv = top("conversion");
  out.push({ key: "conv", title: "Mejor conversión", who: conv?.pos ? conv.name : null, id: conv?.pos ? conv.id : null, detail: conv?.pos ? `${Math.round(conv.value! * 1000) / 10}% de ${conv.m.conversionSample} leads` : "Nadie llega al mínimo de leads", rule: "Leads del período que ya firmaron; requiere el mínimo de leads configurado." });
  const ap = top("aprobados");
  out.push({ key: "aprob", title: "Más reclamos aprobados", who: ap?.pos ? ap.name : null, id: ap?.pos ? ap.id : null, detail: ap?.pos ? `${ap.value} aprobados` : "Sin aprobaciones en el período", rule: "Trabajos que llegaron a \"Aprobado\" en el período." });
  return out;
}

// ---------------- CSV ----------------
export function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((r) => r.map((c) => { const s = c == null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
}
