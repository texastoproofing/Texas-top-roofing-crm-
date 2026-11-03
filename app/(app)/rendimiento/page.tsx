import Link from "next/link";
import { Icon } from "@/components/icons";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { statusInfo } from "@/lib/constants";
import {
  awards, delta, funnel, GOAL_METRICS, goalActual, goalPct, ledger, monthlySeries, monthsBack, computeMetrics,
  RANKINGS, type Metrics, type RankKey,
} from "@/lib/sales";
import { loadSales, rankedReps } from "@/lib/sales-server";
import { buildView, readFilters, repLedger, timeline } from "@/lib/sales-view";
import { Bars, LineChart, monthLabel, SERIES } from "@/components/sales/charts";
import { ActionForm, ComparePicker, FilterBar, GoalBar, Leaderboard, Medal, PlanFields } from "@/components/sales/client";
import { addCommissionEntry, deleteGoal, saveCommissionPlan, saveGoal, saveRepProfile, saveSettings } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  ["resumen", "Resumen", "grid"], ["ranking", "Ranking", "trophy"], ["vendedores", "Vendedores", "users"], ["embudo", "Embudo", "activity"],
  ["comisiones", "Comisiones", "dollar"], ["metas", "Metas y logros", "flag"], ["comparar", "Comparar", "sidebar"],
] as const;
const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const usd2 = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const pctf = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 1000) / 10}%`);
const nf = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

export default async function SalesPerformance({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const d = await loadSales();
  const f = readFilters(searchParams);
  const tab = (TABS.find(([k]) => k === searchParams.tab)?.[0] ?? "resumen") as (typeof TABS)[number][0];
  const v = buildView(d, f);
  const { access } = d;
  const qs = (patch: Record<string, string>) => { const q = new URLSearchParams(Object.entries(searchParams).filter(([, x]) => x) as [string, string][]); for (const [k, x] of Object.entries(patch)) q.set(k, x); return `?${q.toString()}`; };
  const periodTxt = v.period.from === v.period.to ? fmtDate(v.period.from) : `${fmtDate(v.period.from)} – ${fmtDate(v.period.to)}`;
  const visibleTabs = TABS.filter(([k]) => k !== "comisiones" || true);

  return (
    <div className="-mx-4 -mt-5 lg:mx-0 lg:mt-0">
      <header className="bg-night text-white px-4 pt-5 pb-3 lg:rounded-2xl lg:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow text-white/60">Inteligencia comercial</p>
            <h1 className="text-2xl font-bold">Rendimiento de ventas</h1>
            <p className="text-sm text-white/70">{periodTxt} · comparado con {fmtDate(v.prev.from)} – {fmtDate(v.prev.to)} · hora de Texas</p>
          </div>
          <FilterBar territories={d.territories} showSeniority={tab === "comparar" || tab === "ranking"} />
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto -mx-1 px-1" aria-label="Secciones">
          {visibleTabs.map(([k, l, ic]) => (
            <Link key={k} href={qs({ tab: k })} aria-current={tab === k ? "page" : undefined} scroll={false}
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold ${tab === k ? "bg-brand text-white" : "text-white/75 hover:bg-white/10"}`}>
              <Icon name={ic} className="w-4 h-4" />{l}
            </Link>
          ))}
        </nav>
      </header>

      {d.missing && <p className="mx-4 lg:mx-0 mt-4 card p-3 text-sm bg-amber-50 border-amber-200">Falta activar la base de datos de este módulo (migración 0011). Los conteos usan lo disponible; finanzas, comisiones y metas aparecerán al activarla.</p>}

      <div className="px-4 lg:px-0 mt-4 space-y-4">
        {tab === "resumen" && <Overview d={d} v={v} qs={qs} />}
        {tab === "ranking" && (
          <section className="card p-4">
            <h2 className="h2 mb-3">Ranking del equipo</h2>
            <Leaderboard rows={v.rows} initial={(RANKINGS.find((r) => r.key === searchParams.rank)?.key ?? "volumen") as RankKey} minSample={d.settings.minSample} canExport={access.admin} showMoney={access.admin} period={`${v.period.from}_${v.period.to}`} />
          </section>
        )}
        {tab === "vendedores" && <RepsTab d={d} v={v} />}
        {tab === "embudo" && <FunnelTab d={d} v={v} rep={searchParams.rep} />}
        {tab === "comisiones" && <CommissionsTab d={d} v={v} />}
        {tab === "metas" && <GoalsTab d={d} v={v} />}
        {tab === "comparar" && <CompareTab d={d} v={v} ids={(searchParams.cmp ?? "").split(",").filter(Boolean)} />}
      </div>
    </div>
  );
}

type D = Awaited<ReturnType<typeof loadSales>>;
type V = ReturnType<typeof buildView>;

function Kpi({ label, value, d, icon, hint, tone = "bg-canvas text-ink" }: { label: string; value: string; d: { value: number; unit: string } | null; icon: string; hint?: string; tone?: string }) {
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tone}`}><Icon name={icon} className="w-4 h-4" /></span><span className="text-xs font-semibold text-muted leading-tight">{label}</span></div>
      <div className="text-2xl font-bold tnum mt-2">{value}</div>
      <div className="text-xs mt-0.5 min-h-[16px]">
        {d ? <span className={d.value > 0 ? "text-green-700 font-semibold" : d.value < 0 ? "text-red-700 font-semibold" : "text-muted"}>{d.value > 0 ? "↑" : d.value < 0 ? "↓" : "="} {Math.abs(d.value)}{d.unit === "pp" ? " pp" : "%"} <span className="text-muted font-normal">vs. anterior</span></span>
          : <span className="text-muted">{hint ?? "Sin base para comparar"}</span>}
      </div>
    </div>
  );
}

function Overview({ d, v, qs }: { d: D; v: V; qs: (p: Record<string, string>) => string }) {
  const t = v.team, p = v.teamPrev, admin = d.access.admin;
  const myL = repLedger(d, d.access.me.id);
  const teamComm = admin ? t.commission : v.rows.find((r) => r.id === d.access.me.id)?.m.commission ?? null;
  const prevComm = admin ? p.commission : v.rows.find((r) => r.id === d.access.me.id)?.prev.commission ?? null;
  const months = monthsBack(v.today, 6);
  const series = monthlySeries(v.jobs, months);
  const hasValues = series.some((s) => s.value != null);
  const aw = awards(v.rows);
  const tl = timeline(d, v.jobs, v.period, undefined, 12);
  const fn = funnel({ ...v.base, period: v.period, stalledDays: d.settings.stalledDays, today: v.today });
  const top = [...v.rows].filter((r) => r.m.signed > 0 || (r.m.signedValue ?? 0) > 0).sort((a, b) => (b.m.signedValue ?? 0) - (a.m.signedValue ?? 0) || b.m.signed - a.m.signed).slice(0, 5);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Volumen vendido" value={usd(t.signedValue)} d={delta(t.signedValue, p.signedValue)} icon="dollar" tone="bg-brand-soft text-brand" hint={t.signed && t.signedValue == null ? "Faltan montos de contrato" : undefined} />
        <Kpi label="Volumen aprobado" value={usd(t.approvedValue)} d={delta(t.approvedValue, p.approvedValue)} icon="shield" tone="bg-sky-50 text-sky-700" hint={t.approvedClaims && t.approvedValue == null ? "Faltan montos aprobados" : undefined} />
        <Kpi label="Cobrado" value={usd(t.collected)} d={delta(t.collected, p.collected)} icon="inbox" tone="bg-green-50 text-green-700" hint="Solo pagos registrados" />
        <Kpi label="Contratos firmados" value={nf(t.signed)} d={delta(t.signed, p.signed)} icon="file" tone="bg-violet-50 text-violet-700" />
        <Kpi label="Reclamos aprobados" value={nf(t.approvedClaims)} d={delta(t.approvedClaims, p.approvedClaims)} icon="check" tone="bg-emerald-50 text-emerald-700" />
        <Kpi label="Techos completados" value={nf(t.completed)} d={delta(t.completed, p.completed)} icon="home" tone="bg-amber-50 text-amber-700" />
        <Kpi label="Leads generados" value={nf(t.leads)} d={delta(t.leads, p.leads)} icon="users" tone="bg-sky-50 text-sky-700" />
        <Kpi label="Conversión" value={pctf(t.conversion)} d={delta(t.conversion, p.conversion, "pp")} icon="activity" tone="bg-brand-soft text-brand" hint={t.conversionSample ? `de ${nf(t.conversionSample)} leads` : "Sin leads en el período"} />
        <Kpi label="Ticket promedio" value={usd(t.avgDeal)} d={delta(t.avgDeal, p.avgDeal)} icon="dollar" tone="bg-canvas text-ink" />
        <Kpi label={admin ? "Comisiones generadas" : "Mis comisiones"} value={usd(teamComm)} d={delta(teamComm, prevComm)} icon="trophy" tone="bg-amber-50 text-amber-700" hint={t.signed && teamComm == null ? "Falta plan de comisión o montos" : undefined} />
        {admin && <Kpi label="Profit bruto" value={usd(t.grossProfit)} d={delta(t.grossProfit, p.grossProfit)} icon="activity" tone="bg-green-50 text-green-700" hint={t.signed && t.grossProfit == null ? "Faltan costos directos" : undefined} />}
        {admin && <Kpi label="Profit neto" value="—" d={null} icon="shield" hint="Sin reglas contables definidas" />}
      </div>
      {t.cancelled > 0 && <p className="text-xs text-muted">{nf(t.cancelled)} contrato(s) firmados en el período se cancelaron después y no cuentan en volumen ni comisiones.</p>}

      <div className="grid xl:grid-cols-3 gap-4">
        <section className="card p-4 xl:col-span-2">
          <div className="flex items-center justify-between mb-3"><h2 className="h2">Ranking ({RANKINGS[0].label.toLowerCase()})</h2><Link className="link text-sm" href={qs({ tab: "ranking" })}>Ver ranking completo →</Link></div>
          {top.length ? (
            <ol className="divide-y divide-line">
              {top.map((r, i) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <Medal pos={i + 1} />
                  <span className="flex-1 min-w-0 font-semibold truncate">{r.canOpen ? <Link href={`/rendimiento/vendedor/${r.id}`} className="hover:text-brand">{r.name}</Link> : r.name}</span>
                  <span className="text-xs text-muted tnum">{nf(r.m.signed)} contratos</span>
                  <span className="font-bold tnum text-brand w-24 text-right">{usd(r.m.signedValue)}</span>
                  <span className="w-20 hidden sm:block"><GoalBar pct={r.goal?.pct ?? null} /></span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted py-4">Nadie ha firmado contratos en este período.</p>}
        </section>
        <section className="card p-4">
          <h2 className="h2 mb-3">Reconocimientos</h2>
          <ul className="space-y-2.5">
            {aw.map((a) => (
              <li key={a.key} className="flex gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><Icon name="trophy" className="w-4 h-4" /></span>
                <span className="min-w-0"><span className="block text-sm font-semibold">{a.title}</span><span className="block text-xs text-muted">{a.who ? `${a.who} · ${a.detail}` : a.detail}</span></span>
              </li>
            ))}
          </ul>
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Criterios</summary><ul className="mt-1 space-y-1 list-disc pl-4">{aw.map((a) => <li key={a.key}><b>{a.title}:</b> {a.rule}</li>)}</ul></details>
        </section>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <section className="card p-4 xl:col-span-2">
          <h2 className="h2 mb-2">Tendencia del equipo · últimos 6 meses</h2>
          {hasValues
            ? <LineChart title="Volumen vendido por mes" money labels={months.map(monthLabel)} series={[{ name: "Volumen vendido", values: series.map((s) => s.value) }]} />
            : <LineChart title="Contratos firmados por mes" labels={months.map(monthLabel)} series={[{ name: "Contratos firmados", values: series.map((s) => s.signed) }]} />}
          {!hasValues && <p className="text-xs text-muted mt-1">Se muestran contratos porque todavía no hay montos de contrato cargados.</p>}
        </section>
        <section className="card p-4">
          <div className="flex items-center justify-between mb-2"><h2 className="h2">Embudo del equipo</h2><Link className="link text-sm" href={qs({ tab: "embudo" })}>Detalle →</Link></div>
          <FunnelBars fn={fn} />
        </section>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="h2 mb-2">Actividad comercial</h2>
          <Timeline items={tl} reps={d.reps} />
        </section>
        {myL && (
          <section className="card p-4">
            <h2 className="h2 mb-2">{admin ? "Mis comisiones (como vendedor)" : "Mis comisiones"}</h2>
            <LedgerBox l={myL} />
          </section>
        )}
      </div>
    </>
  );
}

function FunnelBars({ fn }: { fn: ReturnType<typeof funnel> }) {
  if (!fn.total) return <p className="text-sm text-muted py-4">No entraron leads en este período.</p>;
  const max = fn.stages[0].n || 1;
  return (
    <ul className="space-y-1.5">
      {fn.stages.map((s, i) => (
        <li key={s.key}>
          <div className="flex justify-between text-xs"><span>{s.label}</span><span className="tnum font-semibold">{s.n} <span className="text-muted font-normal">({pctf(s.cumulative)})</span></span></div>
          <div className="h-3 rounded bg-canvas overflow-hidden"><div className="h-full rounded" style={{ width: `${(s.n / max) * 100}%`, background: SERIES[0], opacity: 1 - i * 0.09 }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ items, reps }: { items: ReturnType<typeof timeline>; reps: D["reps"] }) {
  if (!items.length) return <p className="text-sm text-muted py-4">Sin actividad comercial en este período.</p>;
  const name = new Map(reps.map((r) => [r.id, r.name]));
  return (
    <ol className="space-y-2.5">
      {items.map((e, i) => (
        <li key={i} className="flex gap-2.5 text-sm">
          <span className="w-7 h-7 rounded-lg bg-canvas flex items-center justify-center shrink-0"><Icon name={e.icon} className="w-3.5 h-3.5" /></span>
          <span className="min-w-0">
            <span className="font-semibold">{e.label}</span>{e.amount != null && <span className="tnum"> · {usd2(e.amount)}</span>}
            <span className="block text-xs text-muted truncate">
              {e.jobId ? <Link className="hover:text-brand" href={`/trabajos/${e.jobId}`}>{e.jobLabel}</Link> : e.jobLabel}
              {e.repId && ` · ${name.get(e.repId) ?? "—"}`} · {fmtDateTime(e.at)}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function LedgerBox({ l }: { l: NonNullable<ReturnType<typeof repLedger>> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        {[["Aprobada", l.approved], ["Pagada", l.paid], ["Ajustes / reversos", l.adjustments + l.reversals], ["Saldo pendiente", l.pending]].map(([k, x]) => (
          <div key={k as string} className="rounded-xl bg-canvas p-2"><div className="font-bold tnum">{usd2(x as number)}</div><div className="text-[11px] text-muted">{k}</div></div>
        ))}
      </div>
      {l.entries.length ? (
        <ul className="divide-y divide-line text-sm max-h-64 overflow-y-auto">
          {l.entries.slice(0, 30).map((e: any) => (
            <li key={e.id} className="py-1.5 flex justify-between gap-2"><span className="min-w-0"><b className="capitalize">{e.kind}</b>{e.note && <span className="text-muted"> · {e.note}</span>}<span className="block text-xs text-muted">{fmtDateTime(e.created_at)}</span></span><span className="tnum font-semibold shrink-0">{usd2(Number(e.amount))}</span></li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Sin movimientos de comisión todavía.</p>}
    </div>
  );
}

function RepsTab({ d, v }: { d: D; v: V }) {
  const reps = v.rows.filter((r) => r.canOpen);
  if (!reps.length) return <p className="card p-4 text-sm text-muted">No hay vendedores que puedas ver.</p>;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {reps.map((r) => (
        <Link key={r.id} href={`/rendimiento/vendedor/${r.id}`} className="card p-4 hover:shadow-pop transition">
          <div className="flex items-center gap-3">
            <span className="w-11 h-11 rounded-full bg-night text-white font-semibold flex items-center justify-center">{r.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}</span>
            <span className="min-w-0"><span className="block font-bold truncate">{r.name}</span><span className="block text-xs text-muted">{r.active ? "Activo" : "Inactivo"} · {r.role}</span></span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
            <div className="rounded-lg bg-canvas py-1.5"><div className="font-bold tnum text-sm">{nf(r.m.leads)}</div>Leads</div>
            <div className="rounded-lg bg-canvas py-1.5"><div className="font-bold tnum text-sm">{nf(r.m.signed)}</div>Contratos</div>
            <div className="rounded-lg bg-canvas py-1.5"><div className="font-bold tnum text-sm">{usd(r.m.signedValue)}</div>Volumen</div>
          </div>
          <div className="mt-3"><GoalBar pct={r.goal?.pct ?? null} /></div>
        </Link>
      ))}
    </div>
  );
}

function FunnelTab({ d, v, rep }: { d: D; v: V; rep?: string }) {
  const repOk = rep && d.access.canSeeRep(rep) ? rep : undefined;
  const fn = funnel({ ...v.base, period: v.period, userId: repOk, stalledDays: d.settings.stalledDays, today: v.today });
  const names = rankedReps(d).filter((r) => d.access.canSeeRep(r.id));
  return (
    <>
      <div className="card p-3 flex flex-wrap gap-1.5" role="group" aria-label="Embudo de">
        <Link href="?tab=embudo" className={`chip py-1.5 ${!repOk ? "bg-night text-white border-night" : "bg-white"}`}>Todo el equipo</Link>
        {names.map((r) => <Link key={r.id} href={`?tab=embudo&rep=${r.id}`} className={`chip py-1.5 ${repOk === r.id ? "bg-night text-white border-night" : "bg-white"}`}>{r.name}</Link>)}
      </div>
      <section className="card p-4 overflow-x-auto">
        <h2 className="h2 mb-1">Embudo de ventas · {fn.total} leads que entraron en el período</h2>
        <p className="text-xs text-muted mb-3">Cada lead se sigue hasta hoy. Las etapas siguen el pipeline del CRM: Inspección agendada → Inspeccionado → Reclamo abierto → Aprobado → Contrato firmado → Facturado; "cobrado" = tiene un pago registrado.</p>
        {fn.total ? (
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs text-muted"><tr><th className="text-left py-1.5">Etapa</th><th className="text-right">Cantidad</th><th className="text-right">Desde la etapa anterior</th><th className="text-right">Acumulada</th><th className="text-right">Días prom. desde la anterior</th></tr></thead>
            <tbody>{fn.stages.map((s) => <tr key={s.key} className="border-t border-line"><td className="py-2 font-semibold">{s.label}</td><td className="text-right tnum">{s.n}</td><td className="text-right tnum">{pctf(s.fromPrev)}</td><td className="text-right tnum">{pctf(s.cumulative)}</td><td className="text-right tnum">{s.avgDays ?? "—"}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-sm text-muted">No entraron leads en este período.</p>}
      </section>
      <div className="grid lg:grid-cols-3 gap-4">
        <section className="card p-4"><h3 className="font-semibold mb-1">Rechazo de reclamos</h3><p className="text-3xl font-bold tnum">{pctf(fn.rejectionRate)}</p><p className="text-xs text-muted">{fn.denied} denegados de los reclamos que ya tienen respuesta.</p></section>
        <section className="card p-4"><h3 className="font-semibold mb-2">Leads propios vs. de la empresa</h3>
          <Bars title="Conversión por origen" unit="%" rows={[
            { label: "Propios (puerta a puerta, referidos)", sub: `${fn.own.won} de ${fn.own.n}`, value: fn.own.n ? Math.round((fn.own.won / fn.own.n) * 1000) / 10 : null },
            { label: "De la empresa (comprados, web)", sub: `${fn.paid.won} de ${fn.paid.n}`, value: fn.paid.n ? Math.round((fn.paid.won / fn.paid.n) * 1000) / 10 : null },
          ]} />
        </section>
        <section className="card p-4"><h3 className="font-semibold mb-2">Estancados ({fn.stalled.length})</h3>
          <p className="text-xs text-muted mb-2">Sin cambio de estado en {d.settings.stalledDays} días o más.</p>
          {fn.stalled.length ? <ul className="text-sm space-y-1 max-h-60 overflow-y-auto">{fn.stalled.slice(0, 40).map((s) => <li key={s.id} className="flex justify-between gap-2">{d.canSeeJob(s.id) ? <Link className="truncate hover:text-brand" href={`/trabajos/${s.id}`}>#{s.number} · {s.name}</Link> : <span>#{s.number}</span>}<span className="text-xs text-muted shrink-0">{statusInfo(s.status).label} · {s.days} d</span></li>)}</ul> : <p className="text-sm text-muted">Ninguno.</p>}
        </section>
      </div>
    </>
  );
}

function CommissionsTab({ d, v }: { d: D; v: V }) {
  const admin = d.access.admin;
  const me = d.access.me.id;
  const reps = rankedReps(d);
  const visible = admin ? reps : reps.filter((r) => r.id === me);
  const plansFor = (id: string) => d.plansRaw.filter((p: any) => p.user_id === id);
  const label = (p: any) => [p.profit_pct != null && `${Number(p.profit_pct)}% del profit`, p.sales_pct != null && `${Number(p.sales_pct)}% de la venta`, p.fixed_amount != null && `${usd2(Number(p.fixed_amount))} fijo`].filter(Boolean).join(" + ");
  const signedJobs = v.jobs.filter((j) => j.history.some((h) => ["contrato_firmado", "suplemento", "materiales", "instalacion_agendada", "en_instalacion", "facturado", "pago_parcial", "completado"].includes(h.to)) || ["contrato_firmado", "suplemento", "materiales", "instalacion_agendada", "en_instalacion", "facturado", "pago_parcial", "completado"].includes(j.status));
  return (
    <>
      <p className="text-xs text-muted">{admin ? "Ves las comisiones de todo el equipo." : "Solo ves tus propias comisiones."} La comisión estimada usa el plan vigente en la fecha de firma. Un % del profit necesita los costos directos del trabajo; sin ellos se muestra "—". El 35% del profit está disponible como opción, pero no se aplica a nadie hasta que el administrador lo configure.</p>
      {visible.map((r) => {
        const row = v.rows.find((x) => x.id === r.id);
        const l = repLedger(d, r.id);
        return (
          <section key={r.id} className="card p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div><h2 className="h2">{r.name}</h2><p className="text-xs text-muted">Estimada en el período: <b className="text-ink">{usd2(row?.m.commission)}</b>{row && row.m.commissionMissing > 0 && ` · ${row.m.commissionMissing} trabajo(s) sin datos suficientes`}</p></div>
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-1">Planes de comisión</h3>
              {plansFor(r.id).length ? <ul className="text-sm space-y-1">{plansFor(r.id).map((p: any) => <li key={p.id} className="flex justify-between gap-2"><span>{label(p)}{p.notes && <span className="text-muted"> · {p.notes}</span>}</span><span className="text-xs text-muted shrink-0">{fmtDate(p.valid_from)} – {p.valid_to ? fmtDate(p.valid_to) : "vigente"}</span></li>)}</ul> : <p className="text-sm text-muted">Sin plan configurado.</p>}
            </div>
            {l && <LedgerBox l={l} />}
            {admin && (
              <div className="grid lg:grid-cols-2 gap-4 border-t border-line pt-3">
                <details><summary className="cursor-pointer text-sm font-semibold">Nuevo plan de comisión</summary>
                  <ActionForm className="mt-2" submit="Guardar plan" action={async (x) => { "use server"; return saveCommissionPlan({ userId: r.id, model: x.model, profitPct: x.profitPct ?? "", salesPct: x.salesPct ?? "", fixed: x.fixed ?? "", from: x.from, to: x.to, notes: x.notes }); }}>
                    <PlanFields />
                    <p className="text-[11px] text-muted">Si ya tiene un plan abierto, se cierra el día anterior al nuevo (queda en el historial).</p>
                  </ActionForm>
                </details>
                <details><summary className="cursor-pointer text-sm font-semibold">Registrar movimiento (aprobar, pagar, ajustar, revertir)</summary>
                  <ActionForm className="mt-2" submit="Registrar" action={async (x) => { "use server"; return addCommissionEntry({ userId: r.id, jobId: x.jobId, kind: x.kind, amount: x.amount, note: x.note }); }}>
                    <select name="kind" className="input" aria-label="Tipo"><option value="aprobada">Aprobar comisión de un trabajo</option><option value="pago">Pago (total o parcial)</option><option value="ajuste">Ajuste</option><option value="reverso">Reverso</option></select>
                    <select name="jobId" className="input" aria-label="Trabajo"><option value="">— Sin trabajo —</option>{signedJobs.filter((j) => j.repId === r.id || j.splits?.some((s) => s.userId === r.id)).map((j) => <option key={j.id} value={j.id}>#{j.number} · {j.name}</option>)}</select>
                    <input name="amount" className="input" inputMode="decimal" placeholder="Monto (al aprobar, vacío = calculado)" aria-label="Monto" />
                    <input name="note" className="input" placeholder="Nota (obligatoria en ajustes y reversos)" maxLength={500} aria-label="Nota" />
                    <p className="text-[11px] text-muted">Los movimientos no se editan ni se borran: para corregir, registra un ajuste o reverso.</p>
                  </ActionForm>
                </details>
              </div>
            )}
          </section>
        );
      })}
      {admin && (
        <section className="card p-4">
          <h2 className="h2 mb-1">Total a pagar en comisiones</h2>
          {(() => { const all = ledger(d.entries); return <p className="text-sm">Aprobado {usd2(all.approved)} · Pagado {usd2(all.paid)} · <b>Saldo pendiente {usd2(all.pending)}</b></p>; })()}
          <p className="text-xs text-muted mt-1">Los montos y costos de cada trabajo se cargan en la sección "Finanzas" de cada trabajo.</p>
        </section>
      )}
    </>
  );
}

function GoalsTab({ d, v }: { d: D; v: V }) {
  const admin = d.access.admin;
  const month = v.today.slice(0, 7);
  const monthPeriod = { from: `${month}-01`, to: v.today };
  const goals = d.goals.filter((g) => g.month === month && (admin || g.userId === null || g.userId === d.access.me.id || (g.userId && d.access.canSeeRep(g.userId))));
  const reps = rankedReps(d);
  const name = new Map(reps.map((r) => [r.id, r.name]));
  const metricLabel = (k: string) => GOAL_METRICS.find(([x]) => x === k)?.[1] ?? k;
  const actualOf = (g: (typeof goals)[number]) => goalActual(g.metric, computeMetrics({ ...v.base, period: monthPeriod, userId: g.userId ?? undefined }));
  const aw = awards(v.rows);
  return (
    <>
      <section className="card p-4">
        <h2 className="h2 mb-3">Metas de {monthLabel(month)} {month.slice(0, 4)}</h2>
        {goals.length ? (
          <ul className="space-y-3">
            {goals.map((g) => {
              const a = actualOf(g); const pc = goalPct(a, g.target);
              return (
                <li key={g.id} className="grid sm:grid-cols-[1fr_200px_auto] items-center gap-2">
                  <span className="text-sm"><b>{g.userId ? name.get(g.userId) ?? "Vendedor" : "Equipo completo"}</b> · {metricLabel(g.metric)}<span className="block text-xs text-muted">{g.metric === "volumen" ? `${usd(a)} de ${usd(g.target)}` : `${nf(a)} de ${nf(g.target)}`}</span></span>
                  <GoalBar pct={pc} />
                  {admin && <ActionForm submit="Borrar" action={async () => { "use server"; return deleteGoal(g.id); }}><span /></ActionForm>}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-muted">No hay metas para este mes.</p>}
        {admin && (
          <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm font-semibold">Nueva meta (o cambiar una existente)</summary>
            <ActionForm className="mt-2 grid sm:grid-cols-4 gap-2" submit="Guardar meta" action={async (x) => { "use server"; return saveGoal({ userId: x.userId, month: x.month, metric: x.metric, target: x.target }); }}>
              <select name="userId" className="input" aria-label="Para"><option value="">Equipo completo</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <input name="month" type="month" className="input" defaultValue={month} aria-label="Mes" required />
              <select name="metric" className="input" aria-label="Meta">{GOAL_METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input name="target" className="input" inputMode="decimal" placeholder="Meta" aria-label="Valor de la meta" required />
            </ActionForm>
          </details>
        )}
      </section>
      <section className="card p-4">
        <h2 className="h2 mb-3">Reconocimientos del período</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {aw.map((a) => <div key={a.key} className="rounded-xl border border-line p-3"><div className="text-xs font-semibold text-amber-700">{a.title}</div><div className="font-bold">{a.who ?? "—"}</div><div className="text-xs text-muted">{a.detail}</div><div className="text-[11px] text-muted mt-1">Criterio: {a.rule}</div></div>)}
          <TeamAward d={d} v={v} />
        </div>
      </section>
      {admin && (
        <section className="card p-4">
          <h2 className="h2 mb-2">Ajustes</h2>
          <ActionForm resetOnOk={false} className="grid sm:grid-cols-3 gap-2 items-end" submit="Guardar ajustes" action={async (x) => { "use server"; return saveSettings({ minSample: x.minSample, stalledDays: x.stalledDays }); }}>
            <label className="label">Mínimo de leads para rankings de % <input name="minSample" type="number" min={1} max={100} className="input mt-1" defaultValue={d.settings.minSample} /></label>
            <label className="label">Días sin cambio = estancado <input name="stalledDays" type="number" min={1} max={365} className="input mt-1" defaultValue={d.settings.stalledDays} /></label>
          </ActionForm>
          <h3 className="font-semibold text-sm mt-4 mb-2">Datos de cada vendedor</h3>
          <div className="space-y-2">
            {reps.map((r) => (
              <details key={r.id} className="rounded-xl border border-line p-2.5"><summary className="cursor-pointer text-sm font-semibold">{r.name} <span className="text-xs text-muted font-normal">· ingreso {r.hireDate ? fmtDate(r.hireDate) : "sin dato"}</span></summary>
                <ActionForm resetOnOk={false} className="mt-2 grid sm:grid-cols-3 gap-2" submit="Guardar" action={async (x) => { "use server"; return saveRepProfile({ userId: r.id, hireDate: x.hireDate, supervisorId: x.supervisorId, territoryId: x.territoryId }); }}>
                  <label className="label">Fecha de ingreso<input name="hireDate" type="date" className="input mt-1" defaultValue={r.hireDate ?? ""} /></label>
                  <label className="label">Supervisor<select name="supervisorId" className="input mt-1" defaultValue={r.supervisorId ?? ""}><option value="">Ninguno</option>{d.reps.filter((x) => x.id !== r.id && x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                  <label className="label">Territorio<select name="territoryId" className="input mt-1" defaultValue={r.territoryId ?? ""}><option value="">Ninguno</option>{d.territories.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></label>
                </ActionForm>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function TeamAward({ d, v }: { d: D; v: V }) {
  const month = v.today.slice(0, 7);
  const g = d.goals.find((x) => x.userId === null && x.month === month);
  const actual = g ? goalActual(g.metric, computeMetrics({ ...v.base, period: { from: `${month}-01`, to: v.today } })) : null;
  const pc = g ? goalPct(actual, g.target) : null;
  return <div className="rounded-xl border border-line p-3"><div className="text-xs font-semibold text-amber-700">Rendimiento del equipo</div><div className="font-bold">{pc == null ? "—" : `${pc}% de la meta`}</div><div className="text-xs text-muted">{g ? GOAL_METRICS.find(([k]) => k === g.metric)?.[1] : "No hay meta de equipo este mes"}</div><div className="text-[11px] text-muted mt-1">Criterio: avance del equipo contra su meta del mes.</div></div>;
}

function CompareTab({ d, v, ids }: { d: D; v: V; ids: string[] }) {
  const can = v.rows.filter((r) => r.canOpen);
  const sel = ids.filter((id) => can.some((r) => r.id === id)).slice(0, 5);
  const rows = sel.map((id) => can.find((r) => r.id === id)!);
  const months = monthsBack(v.today, 6);
  const metric = (k: (m: Metrics) => number | null) => rows.map((r, i) => ({ label: r.name, value: k(r.m), color: SERIES[i] }));
  return (
    <>
      <section className="card p-4"><h2 className="h2 mb-2">Comparar vendedores</h2><ComparePicker reps={can.map((r) => ({ id: r.id, name: r.name }))} selected={sel} /></section>
      {rows.length >= 2 ? (
        <>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            <section className="card p-4"><h3 className="font-semibold mb-2">Volumen de ventas</h3><Bars title="Volumen" money rows={metric((m) => m.signedValue)} /></section>
            <section className="card p-4"><h3 className="font-semibold mb-2">Oportunidades (leads)</h3><Bars title="Leads" rows={metric((m) => m.leads)} /></section>
            <section className="card p-4"><h3 className="font-semibold mb-2">Conversión</h3><Bars title="Conversión" unit="%" rows={rows.map((r, i) => ({ label: r.name, sub: `${nf(r.m.conversionSample)} leads`, value: r.m.conversion == null ? null : Math.round(r.m.conversion * 1000) / 10, color: SERIES[i] }))} /></section>
            <section className="card p-4"><h3 className="font-semibold mb-2">Ticket promedio</h3><Bars title="Ticket" money rows={metric((m) => m.avgDeal)} /></section>
            <section className="card p-4"><h3 className="font-semibold mb-2">Reclamos aprobados</h3><Bars title="Aprobados" rows={metric((m) => m.approvedClaims)} /></section>
            <section className="card p-4"><h3 className="font-semibold mb-2">Cumplimiento de meta (mes)</h3><Bars title="Meta" unit="%" rows={rows.map((r, i) => ({ label: r.name, value: r.goal?.pct ?? null, color: SERIES[i] }))} /></section>
            {d.access.admin && <section className="card p-4"><h3 className="font-semibold mb-2">Rentabilidad (profit bruto)</h3><Bars title="Profit" money rows={metric((m) => m.grossProfit)} /></section>}
          </div>
          <section className="card p-4">
            <h3 className="font-semibold mb-2">Productividad mensual · contratos firmados</h3>
            <LineChart title="Contratos por mes" labels={months.map(monthLabel)} series={rows.map((r, i) => ({ name: r.name, values: monthlySeries(v.jobs, months, r.id).map((s) => s.signed), color: SERIES[i] }))} />
          </section>
        </>
      ) : <p className="card p-4 text-sm text-muted">Escoge al menos 2 vendedores para comparar.{can.length < 2 && " Por ahora solo hay un vendedor con datos que puedes ver."}</p>}
    </>
  );
}
