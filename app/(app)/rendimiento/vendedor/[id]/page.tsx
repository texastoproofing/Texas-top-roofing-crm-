import Link from "next/link";
import { Icon } from "@/components/icons";
import { fmtDate } from "@/lib/format";
import { statusInfo } from "@/lib/constants";
import { computeMetrics, funnel, GOAL_METRICS, goalActual, goalPct, monthlySeries, monthsBack } from "@/lib/sales";
import { loadSales, rankedReps } from "@/lib/sales-server";
import { backingJobs, buildView, readFilters, repLedger, timeline } from "@/lib/sales-view";
import { LineChart, monthLabel, SERIES } from "@/components/sales/charts";
import { FilterBar, GoalBar } from "@/components/sales/client";

export const dynamic = "force-dynamic";
const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const usd2 = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const pctf = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 1000) / 10}%`);
const nf = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const ROLE: Record<string, string> = { administrador: "Administrador", vendedor: "Vendedor", project_manager: "Project manager", asistente: "Asistente" };

export default async function RepProfile({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const d = await loadSales();
  const rep = d.reps.find((r) => r.id === params.id);
  const back = { href: `/rendimiento?tab=vendedores${searchParams.p ? `&p=${searchParams.p}` : ""}`, label: "Rendimiento de ventas" };
  if (!rep || !d.access.canSeeRep(rep.id)) {
    return <div className="card p-6 text-center space-y-2"><p className="font-semibold">No tienes permiso para ver este perfil.</p><Link className="link" href={back.href}>Volver</Link></div>;
  }
  const v = buildView(d, readFilters(searchParams));
  const row = v.rows.find((r) => r.id === rep.id);
  const m = row?.m ?? computeMetrics({ ...v.base, period: v.period, userId: rep.id });
  const money = d.access.canSeeMoneyOf(rep.id);
  const sup = rep.supervisorId ? d.reps.find((r) => r.id === rep.supervisorId)?.name : null;
  const terr = rep.territoryId ? d.territories.find((t) => t.id === rep.territoryId) : null;
  const plan = money ? d.plansRaw.find((p: any) => p.user_id === rep.id && (!p.valid_to || p.valid_to >= v.today) && p.valid_from <= v.today) : null;
  const l = repLedger(d, rep.id);
  const months = monthsBack(v.today, 12);
  const mine = monthlySeries(v.jobs, months, rep.id);
  const teamN = Math.max(1, rankedReps(d).filter((r) => r.active).length);
  const team = monthlySeries(v.jobs, months).map((s) => ({ ...s, avgSigned: Math.round((s.signed / teamN) * 10) / 10, avgValue: s.value == null ? null : Math.round(s.value / teamN) }));
  const useValue = mine.some((s) => s.value != null);
  let acc = 0; const cumulative = mine.map((s) => (acc += useValue ? s.value ?? 0 : s.signed));
  const fn = funnel({ ...v.base, period: v.period, userId: rep.id, stalledDays: d.settings.stalledDays, today: v.today });
  const month = v.today.slice(0, 7);
  const goals = d.goals.filter((g) => g.userId === rep.id && g.month === month);
  const mMonth = computeMetrics({ ...v.base, period: { from: `${month}-01`, to: v.today }, userId: rep.id });
  const jobs = backingJobs(d, v.jobs, v.period, rep.id);
  const tl = timeline(d, v.jobs, v.period, rep.id, 15);
  const ini = rep.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const planTxt = plan ? [plan.profit_pct != null && `${Number(plan.profit_pct)}% del profit`, plan.sales_pct != null && `${Number(plan.sales_pct)}% de la venta`, plan.fixed_amount != null && `${usd2(Number(plan.fixed_amount))} fijo`].filter(Boolean).join(" + ") : null;
  const appts = v.appts.filter((a) => a.assignedTo === rep.id);
  const stat = (label: string, value: string, sub?: string) => <div className="rounded-xl bg-canvas p-3"><div className="text-[11px] text-muted">{label}</div><div className="text-lg font-bold tnum">{value}</div>{sub && <div className="text-[10px] text-muted">{sub}</div>}</div>;

  return (
    <div className="space-y-4">
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><Icon name="chevronLeft" className="w-4 h-4" />{back.label}</Link>
      <header className="card p-4 bg-night text-white border-0">
        <div className="flex flex-wrap items-center gap-4">
          <span className="w-16 h-16 rounded-full bg-brand text-white text-xl font-bold flex items-center justify-center" aria-hidden>{ini}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">{rep.name}</h1>
            <p className="text-sm text-white/70">{ROLE[rep.role] ?? rep.role} · {rep.active ? "Activo" : "Inactivo"} · ingreso {rep.hireDate ? fmtDate(rep.hireDate) : "sin dato"}</p>
            <p className="text-sm text-white/70">Supervisor: {sup ?? "—"} · Territorio: {terr ? `${terr.code} · ${terr.name}` : "—"}{money && ` · Comisión: ${planTxt ?? "sin plan"}`}</p>
          </div>
          <div className="w-full sm:w-auto"><FilterBar territories={d.territories} /></div>
        </div>
      </header>

      <section className="card p-4">
        <h2 className="h2 mb-3">Estadísticas del período</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {stat("Leads asignados", nf(m.leads))}
          {stat("Leads propios", nf(m.ownLeads), "puerta a puerta, referidos")}
          {stat("Leads de la empresa", nf(m.companyLeads), "comprados, web")}
          {stat("Citas programadas", String(m.appointments))}
          {stat("Citas completadas", String(m.apptsDone), "fecha ya pasó")}
          {stat("Inspecciones", nf(m.inspections))}
          {stat("Contratos firmados", nf(m.signed))}
          {stat("Volumen vendido", usd(m.signedValue))}
          {stat("Reclamos aprobados", nf(m.approvedClaims))}
          {stat("Reclamos rechazados", nf(m.denied))}
          {stat("Proyectos completados", nf(m.completed))}
          {stat("Ventas cobradas", usd(m.collected))}
          {stat("Conversión", pctf(m.conversion), `de ${nf(m.conversionSample)} leads`)}
          {stat("Ticket promedio", usd(m.avgDeal))}
          {money && stat("Comisión estimada", usd2(m.commission))}
          {money && l && stat("Comisiones pendientes", usd2(l.pending))}
          {money && l && stat("Comisiones pagadas", usd2(l.paid))}
          {money && stat("Profit bruto", usd(m.grossProfit))}
        </div>
      </section>

      <div className="grid xl:grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="h2 mb-2">{useValue ? "Ventas por mes" : "Contratos por mes"} vs. promedio del equipo</h2>
          <LineChart title="Evolución mensual" money={useValue} labels={months.map(monthLabel)} series={[
            { name: rep.name, values: mine.map((s) => (useValue ? s.value : s.signed)), color: SERIES[0] },
            { name: "Promedio del equipo", values: team.map((s) => (useValue ? s.avgValue : s.avgSigned)), color: SERIES[1], dashed: true },
          ]} />
        </section>
        <section className="card p-4">
          <h2 className="h2 mb-2">{useValue ? "Ventas acumuladas" : "Contratos acumulados"} (12 meses)</h2>
          <LineChart title="Acumulado" money={useValue} labels={months.map(monthLabel)} series={[{ name: "Acumulado", values: cumulative }]} />
        </section>
        <section className="card p-4">
          <h2 className="h2 mb-2">Conversión por etapa</h2>
          {fn.total ? (
            <table className="w-full text-sm"><tbody>{fn.stages.map((s) => <tr key={s.key} className="border-t border-line first:border-0"><td className="py-1.5">{s.label}</td><td className="text-right tnum font-semibold">{s.n}</td><td className="text-right tnum text-muted w-20">{pctf(s.fromPrev)}</td></tr>)}</tbody></table>
          ) : <p className="text-sm text-muted">No entraron leads de este vendedor en el período.</p>}
        </section>
        <section className="card p-4">
          <h2 className="h2 mb-2">Metas de {monthLabel(month)}</h2>
          {goals.length ? <ul className="space-y-3">{goals.map((g) => { const a = goalActual(g.metric, mMonth); return <li key={g.id}><div className="flex justify-between text-sm"><span>{GOAL_METRICS.find(([k]) => k === g.metric)?.[1]}</span><span className="text-muted tnum">{g.metric === "volumen" ? `${usd(a)} / ${usd(g.target)}` : `${nf(a)} / ${nf(g.target)}`}</span></div><GoalBar pct={goalPct(a, g.target)} /></li>; })}</ul> : <p className="text-sm text-muted">Sin metas para este mes.</p>}
        </section>
      </div>

      <section className="card p-4">
        <h2 className="h2 mb-2">Trabajos que respaldan los números</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {([["Contratos firmados", jobs.firmados], ["Reclamos aprobados", jobs.aprobados], ["Techos completados", jobs.techos], ["Leads del período", jobs.leads]] as const).map(([t, list]) => (
            <div key={t}><h3 className="text-sm font-semibold mb-1">{t} ({list.length})</h3>
              {list.length ? <ul className="text-sm space-y-1">{list.slice(0, 30).map((j) => <li key={j.id}>{j.open ? <Link className="hover:text-brand" href={`/trabajos/${j.id}`}>#{j.number} · {j.name}</Link> : <span>Trabajo #{j.number}</span>}<span className="block text-[11px] text-muted">{statusInfo(j.status).label}</span></li>)}</ul> : <p className="text-xs text-muted">Ninguno.</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="h2 mb-2">Actividad</h2>
        {tl.length ? <ul className="text-sm space-y-1.5">{tl.map((e, i) => <li key={i} className="flex justify-between gap-2"><span className="min-w-0 truncate"><b>{e.label}</b> · {e.jobId ? <Link className="hover:text-brand" href={`/trabajos/${e.jobId}`}>{e.jobLabel}</Link> : e.jobLabel}{e.amount != null && ` · ${usd2(e.amount)}`}</span><span className="text-xs text-muted shrink-0">{fmtDate(e.at)}</span></li>)}</ul> : <p className="text-sm text-muted">Sin actividad en el período.</p>}
        <p className="text-[11px] text-muted mt-2">Citas asignadas registradas: {appts.length}.</p>
      </section>
    </div>
  );
}
