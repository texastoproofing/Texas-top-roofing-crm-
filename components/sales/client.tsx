"use client";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { PRESETS, RANKINGS, TIE_RULE, rank, toCsv, type Metrics, type RankKey } from "@/lib/sales";

const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const pctf = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 1000) / 10}%`);
const nf = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const KEY = "ttr-sales-filters";

// ---------------- Filtros (URL + recordados en este navegador) ----------------
export function FilterBar({ territories, showSeniority }: { territories: { id: string; code: string; name: string }[]; showSeniority?: boolean }) {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const [pending, start] = useTransition();
  const cur = (k: string) => sp.get(k) ?? "";
  const set = (patch: Record<string, string>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? q.set(k, v) : q.delete(k);
    if (patch.p && patch.p !== "custom") { q.delete("from"); q.delete("to"); }
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(["p", "from", "to", "terr", "src", "ant"].map((k) => [k, q.get(k) ?? ""])))); } catch {}
    start(() => router.replace(`${path}?${q.toString()}`, { scroll: false }));
  };
  // Restaura los filtros guardados si la URL no trae ninguno
  useEffect(() => {
    if (["p", "terr", "src", "ant"].some((k) => sp.get(k))) return;
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (s && Object.values(s).some(Boolean)) { const q = new URLSearchParams(sp.toString()); for (const [k, v] of Object.entries(s)) if (v) q.set(k, String(v)); router.replace(`${path}?${q.toString()}`, { scroll: false }); }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const p = cur("p") || "mes";
  return (
    <div className={`flex flex-wrap items-end gap-2 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <label className="text-xs text-white/70">Período
        <select className="input mt-1 min-h-[40px] py-1.5 bg-white text-ink" value={p} onChange={(e) => set({ p: e.target.value })}>
          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {p === "custom" && (
        <>
          <label className="text-xs text-white/70">Desde<input type="date" className="input mt-1 min-h-[40px] py-1.5 bg-white text-ink" defaultValue={cur("from")} onChange={(e) => e.target.value && set({ p: "custom", from: e.target.value, to: cur("to") || e.target.value })} /></label>
          <label className="text-xs text-white/70">Hasta<input type="date" className="input mt-1 min-h-[40px] py-1.5 bg-white text-ink" defaultValue={cur("to")} onChange={(e) => e.target.value && set({ p: "custom", to: e.target.value, from: cur("from") || e.target.value })} /></label>
        </>
      )}
      <label className="text-xs text-white/70">Territorio
        <select className="input mt-1 min-h-[40px] py-1.5 bg-white text-ink" value={cur("terr")} onChange={(e) => set({ terr: e.target.value })}>
          <option value="">Todos</option>{territories.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
        </select>
      </label>
      <label className="text-xs text-white/70">Origen del lead
        <select className="input mt-1 min-h-[40px] py-1.5 bg-white text-ink" value={cur("src")} onChange={(e) => set({ src: e.target.value })}>
          <option value="">Todos</option><option value="propio">Propios</option><option value="empresa">De la empresa</option><option value="otro">Otros</option>
        </select>
      </label>
      {showSeniority && (
        <label className="text-xs text-white/70">Antigüedad
          <select className="input mt-1 min-h-[40px] py-1.5 bg-white text-ink" value={cur("ant")} onChange={(e) => set({ ant: e.target.value })}>
            <option value="">Cualquiera</option><option value="nuevo">Menos de 6 meses</option><option value="medio">6 a 12 meses</option><option value="veterano">Más de 1 año</option>
          </select>
        </label>
      )}
    </div>
  );
}

// ---------------- Ranking ----------------
export type LbRow = { id: string; name: string; canOpen: boolean; m: Metrics; goal: { pct: number | null; metric: string } | null };
type Col = { k: string; l: string; v: (r: LbRow) => number | null; fmt: (n: number | null) => string; fin?: boolean };
const COLS: Col[] = [
  { k: "vol", l: "Volumen", v: (r) => r.m.signedValue, fmt: usd },
  { k: "con", l: "Contratos", v: (r) => r.m.signed, fmt: nf },
  { k: "apr", l: "Aprobados", v: (r) => r.m.approvedClaims, fmt: nf },
  { k: "tec", l: "Techos", v: (r) => r.m.completed, fmt: nf },
  { k: "cnv", l: "Conversión", v: (r) => r.m.conversion, fmt: pctf },
  { k: "avg", l: "Ticket prom.", v: (r) => r.m.avgDeal, fmt: usd },
  { k: "com", l: "Comisión", v: (r) => r.m.commission, fmt: usd, fin: true },
];

export function Leaderboard({ rows, initial, minSample, canExport, showMoney, period }: { rows: LbRow[]; initial: RankKey; minSample: number; canExport: boolean; showMoney: boolean; period: string }) {
  const [tab, setTab] = useState<RankKey>(initial);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const tabs = RANKINGS.filter((r) => showMoney || !r.fin);
  const R = RANKINGS.find((r) => r.key === tab)!;
  const ranked = useMemo(() => rank(rows, tab), [rows, tab]);
  const cols = COLS.filter((c) => showMoney || !c.fin);
  let list = ranked.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  if (sort) { const c = cols.find((x) => x.k === sort.k)!; list = [...list].sort((a, b) => sort.dir * ((c.v(a) ?? -Infinity) - (c.v(b) ?? -Infinity))); }
  const fmtMain = (v: number | null) => (v == null ? "—" : tab === "volumen" || tab === "profit" ? usd(v) : tab === "conversion" ? pctf(v) : tab === "rapidez" ? `${v} días` : nf(v));
  const exportCsv = () => {
    const csv = toCsv([["Posición", "Vendedor", ...cols.map((c) => c.l), "Muestra conversión", "Meta %"], ...ranked.map((r) => [r.pos ?? "", r.name, ...cols.map((c) => c.v(r)), r.m.conversionSample, r.goal?.pct ?? ""])]);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `ranking-${tab}-${period}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Rankings">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setSort(null); }}
            className={`chip shrink-0 py-1.5 ${tab === t.key ? "bg-night text-white border-night" : "bg-white"}`}>{t.label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[180px]"><span className="sr-only">Buscar vendedor</span>
          <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar vendedor" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {canExport && <button type="button" className="btn-secondary btn-sm" onClick={exportCsv}><Icon name="import" className="w-4 h-4" />Exportar CSV</button>}
      </div>
      {/* Escritorio: tabla */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-xs text-muted">
            <tr>
              <th className="text-left px-3 py-2 w-10">#</th><th className="text-left px-3 py-2">Vendedor</th>
              <th className="text-right px-3 py-2">{R.label}</th>
              {cols.map((c) => (
                <th key={c.k} className="text-right px-3 py-2 whitespace-nowrap">
                  <button type="button" className="hover:text-ink" onClick={() => setSort(sort?.k === c.k ? { k: c.k, dir: sort.dir === -1 ? 1 : -1 } : { k: c.k, dir: -1 })} aria-label={`Ordenar por ${c.l}`}>
                    {c.l}{sort?.k === c.k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th className="text-left px-3 py-2 w-32">Meta del mes</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-canvas/60">
                <td className="px-3 py-2"><Medal pos={r.pos} /></td>
                <td className="px-3 py-2"><RepName r={r} /></td>
                <td className="px-3 py-2 text-right font-bold tnum text-brand">{fmtMain(r.value)}</td>
                {cols.map((c) => <td key={c.k} className="px-3 py-2 text-right tnum">{c.fmt(c.v(r))}{c.k === "cnv" && r.m.conversionSample > 0 && <span className="block text-[10px] text-muted">de {nf(r.m.conversionSample)} leads</span>}</td>)}
                <td className="px-3 py-2"><GoalBar pct={r.goal?.pct ?? null} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Móvil: tarjetas */}
      <ul className="md:hidden space-y-2">
        {list.map((r) => (
          <li key={r.id} className="card p-3">
            <div className="flex items-center gap-3"><Medal pos={r.pos} /><div className="flex-1 min-w-0"><RepName r={r} /></div><div className="text-right font-bold tnum text-brand">{fmtMain(r.value)}</div></div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-center text-xs">
              {cols.slice(0, 6).map((c) => <div key={c.k} className="rounded-lg bg-canvas py-1.5"><div className="font-semibold tnum text-sm">{c.fmt(c.v(r))}</div><div className="text-muted">{c.l}</div></div>)}
            </div>
            {r.goal && <div className="mt-2"><GoalBar pct={r.goal.pct} /></div>}
          </li>
        ))}
      </ul>
      {!list.length && <p className="text-sm text-muted text-center py-6">No hay vendedores con ese nombre.</p>}
      <p className="text-[11px] text-muted">{TIE_RULE} {tab === "conversion" && `Para entrar al ranking de conversión se necesitan al menos ${minSample} leads en el período.`} Quien no tiene datos en el período aparece al final sin posición.</p>
    </div>
  );
}
function RepName({ r }: { r: { id: string; name: string; canOpen: boolean } }) {
  const ini = r.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
  const inner = <span className="flex items-center gap-2 min-w-0"><span className="w-8 h-8 rounded-full bg-night text-white text-xs font-semibold flex items-center justify-center shrink-0" aria-hidden>{ini}</span><span className="font-semibold truncate">{r.name}</span></span>;
  return r.canOpen ? <Link href={`/rendimiento/vendedor/${r.id}`} className="hover:text-brand">{inner}</Link> : inner;
}
export function Medal({ pos }: { pos: number | null }) {
  if (pos == null) return <span className="text-muted text-sm">—</span>;
  const c = pos === 1 ? "bg-amber-400 text-white" : pos === 2 ? "bg-gray-400 text-white" : pos === 3 ? "bg-orange-700 text-white" : "bg-canvas text-ink";
  return <span className={`inline-flex w-7 h-7 rounded-full items-center justify-center text-xs font-bold ${c}`}>{pos}</span>;
}
export function GoalBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-muted">Sin meta</span>;
  const tone = pct >= 100 ? "bg-green-600" : pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-brand";
  return <div><div className="text-xs font-semibold tnum">{pct}%</div><div className="h-1.5 rounded-full bg-canvas overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} /></div></div>;
}

// ---------------- Comparar 2 a 5 vendedores ----------------
export function ComparePicker({ reps, selected }: { reps: { id: string; name: string }[]; selected: string[] }) {
  const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const [sel, setSel] = useState<string[]>(selected);
  const apply = (ids: string[]) => { const q = new URLSearchParams(sp.toString()); ids.length ? q.set("cmp", ids.join(",")) : q.delete("cmp"); router.replace(`${path}?${q.toString()}`, { scroll: false }); };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vendedores a comparar">
        {reps.map((r) => {
          const on = sel.includes(r.id);
          return <button key={r.id} type="button" aria-pressed={on} disabled={!on && sel.length >= 5}
            onClick={() => setSel(on ? sel.filter((x) => x !== r.id) : [...sel, r.id])}
            className={`chip py-1.5 disabled:opacity-40 ${on ? "bg-night text-white border-night" : "bg-white"}`}>{r.name}</button>;
        })}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary btn-sm" disabled={sel.length < 2} onClick={() => apply(sel)}>Comparar {sel.length || ""}</button>
        <span className="text-xs text-muted">Escoge de 2 a 5 vendedores.</span>
      </div>
    </div>
  );
}

// ---------------- Formularios de administración ----------------
type Res = { ok: true; msg?: string } | { ok: false; error: string };
export function ActionForm({ action, children, submit, className = "", resetOnOk = true }: {
  action: (v: Record<string, string>) => Promise<Res>; children: ReactNode; submit: string; className?: string; resetOnOk?: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const router = useRouter();
  return (
    <form className={`space-y-2 ${className}`} onSubmit={(e) => {
      e.preventDefault(); if (pending) return;
      const form = e.currentTarget; const v = Object.fromEntries(Array.from(new FormData(form).entries()).map(([k, x]) => [k, String(x)]));
      start(async () => {
        const r = await action(v).catch(() => ({ ok: false as const, error: "Sin conexión. Intenta de nuevo." }));
        setMsg(r.ok ? { ok: true, t: r.msg ?? "Guardado." } : { ok: false, t: r.error });
        if (r.ok) { if (resetOnOk) form.reset(); router.refresh(); }
      });
    }}>
      {children}
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-primary btn-sm" disabled={pending}>{pending ? "Guardando…" : submit}</button>
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.t}</span>}
      </div>
    </form>
  );
}

export function PlanFields() {
  const [model, setModel] = useState("profit_pct");
  return (
    <div className="grid sm:grid-cols-3 gap-2">
      <label className="label sm:col-span-3">Modelo
        <select name="model" className="input mt-1" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="profit_pct">% del profit</option><option value="sales_pct">% de la venta</option><option value="fixed">Comisión fija por trabajo</option><option value="mixed">Mixto</option>
        </select>
      </label>
      {(model === "profit_pct" || model === "mixed") && <label className="label">% del profit<input name="profitPct" className="input mt-1" inputMode="decimal" placeholder="Ej. 35" /></label>}
      {(model === "sales_pct" || model === "mixed") && <label className="label">% de la venta<input name="salesPct" className="input mt-1" inputMode="decimal" placeholder="Ej. 10" /></label>}
      {(model === "fixed" || model === "mixed") && <label className="label">Monto fijo (USD)<input name="fixed" className="input mt-1" inputMode="decimal" placeholder="Ej. 500" /></label>}
      <label className="label">Desde<input name="from" type="date" className="input mt-1" required /></label>
      <label className="label">Hasta (opcional)<input name="to" type="date" className="input mt-1" /></label>
      <label className="label sm:col-span-3">Nota<input name="notes" className="input mt-1" maxLength={500} placeholder="Ej. acuerdo firmado el…" /></label>
    </div>
  );
}
