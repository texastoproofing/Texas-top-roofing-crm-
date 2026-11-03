"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  EXPOSURE_COLOR, EXPOSURE_LABEL, FOLLOWUP_LABEL, WEIGHT_LABELS, leadExposure, periodFromPreset, inPeriod, scoreZips,
  stageOf, toCsv, zipOfPoint, type Assignment, type LeadExposure, type StormEvent, type StormJob, type Swath,
  type Weights, type ZipInfo, type ZipScore, type ZipStat, type Exposure,
} from "@/lib/storm";
import { statusInfo } from "@/lib/constants";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { assignZip, endAssignment, reviewAlert, saveStormSettings, syncHistoryBatch, syncRecent } from "@/app/(app)/tormentas/actions";
import { swathColor, type MapLayers } from "./StormMap";

const StormMap = dynamic(() => import("./StormMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-xl bg-gray-100 flex items-center justify-center text-sm text-gray-500">Cargando mapa…</div>,
});

type Alert = { id: string; title: string; zips: string[]; leads_nearby: number; is_realtime: boolean; status: string; created_at: string; event: any };
type SyncJob = { id: string; range_start: string; range_end: string; status: string; inserted: number; skipped: number; error: string | null; started_at: string; finished_at: string | null };
type Settings = { weights: Weights; alert_min_hail_in: number; alert_min_wind_mph: number; history_start: string; updated_at: string };
type Tab = "panel" | "mapa" | "zips" | "leads" | "eventos" | "alertas" | "ajustes";

const SOURCE_LABEL: Record<string, string> = { spc: "NOAA/SPC (preliminar)", compilado: "NWS/NOAA compilado", hailpoint: "HailPoint radar (estimado)" };

function download(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function StormApp(props: {
  isAdmin: boolean; today: string; settings: Settings; zips: ZipInfo[]; stats: ZipStat[]; swaths: Swath[]; events: StormEvent[];
  assignments: Assignment[]; alerts: Alert[]; syncJobs: SyncJob[]; jobs: StormJob[]; users: { id: string; name: string; role: string }[];
  initial: Record<string, string | undefined>; tileUrl: string; tileAttribution: string;
}) {
  const { zips, stats, swaths, events, assignments, jobs, settings, today, isAdmin } = props;
  const router = useRouter();
  const pathname = usePathname();
  const ini = props.initial;

  // ---------- Filtros (se guardan en el enlace para compartir la vista) ----------
  const [tab, setTab] = useState<Tab>((ini.tab as Tab) || "panel");
  const [preset, setPreset] = useState(ini.periodo || "730");
  const [from, setFrom] = useState(ini.desde || "");
  const [to, setTo] = useState(ini.hasta || "");
  const [tipo, setTipo] = useState(ini.tipo || "ambos");
  const [minHail, setMinHail] = useState(ini.granizo || "0");
  const [minWind, setMinWind] = useState(ini.viento || "0");
  const [fuente, setFuente] = useState(ini.fuente || "todas");
  const [q, setQ] = useState(ini.q || "");
  const [rep, setRep] = useState(ini.vendedor || "todos");
  const [expF, setExpF] = useState(ini.exposicion || "todas");
  const [layers, setLayers] = useState<MapLayers>({ swaths: true, hail: true, wind: true, zips: true, leads: true, territories: true });
  const [sel, setSel] = useState<{ kind: "zip" | "event" | "lead"; id: string } | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const period = preset === "custom" && from && to ? { from, to } : periodFromPreset(preset, today, settings.history_start);

  useEffect(() => {
    const u = new URLSearchParams();
    const set = (k: string, v: string, def: string) => { if (v && v !== def) u.set(k, v); };
    set("tab", tab, "panel"); set("periodo", preset, "730"); if (preset === "custom") { set("desde", from, ""); set("hasta", to, ""); }
    set("tipo", tipo, "ambos"); set("granizo", minHail, "0"); set("viento", minWind, "0"); set("fuente", fuente, "todas");
    set("q", q, ""); set("vendedor", rep, "todos"); set("exposicion", expF, "todas");
    const qs = u.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [tab, preset, from, to, tipo, minHail, minWind, fuente, q, rep, expF, pathname]);

  // ---------- Datos filtrados ----------
  const eventZip = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const e of events) m.set(e.id, zipOfPoint(e.lat, e.lng, zips) ?? e.zip ?? null);
    return m;
  }, [events, zips]);

  const ql = q.trim().toLowerCase();
  const zipMatch = (zip: string | null) => {
    if (!ql) return true;
    if (!zip) return false;
    const name = zips.find((z) => z.zip === zip)?.name ?? "";
    return zip.includes(ql) || name.toLowerCase().includes(ql);
  };

  const fEvents = events.filter((e) => inPeriod(e.event_date, period)
    && (fuente === "todas" || (fuente === "observado" && e.source_key !== "hailpoint") || (fuente === "estimado" && false))
    && (tipo === "ambos" || e.event_type === tipo)
    && (e.event_type !== "granizo" || (e.hail_in ?? 0) >= Number(minHail))
    && (e.event_type !== "viento" || Number(minWind) === 0 || (e.wind_mph ?? 0) >= Number(minWind))
    && (!ql || zipMatch(eventZip.get(e.id) ?? null) || (e.location_text ?? "").toLowerCase().includes(ql) || (e.county ?? "").toLowerCase().includes(ql)));
  const fSwaths = swaths.filter((s) => inPeriod(s.event_date, period) && fuente !== "observado" && tipo !== "viento" && s.min_hail_in >= Number(minHail));
  const fStats = stats.filter((s) => fuente !== "observado" && tipo !== "viento" && s.max_hail_in >= Number(minHail));
  const fJobs = jobs.filter((j) => (rep === "todos" || j.repId === rep) && (!ql || zipMatch(j.zip) || j.customer.toLowerCase().includes(ql) || j.address.toLowerCase().includes(ql)));

  const scores = useMemo(() => scoreZips({
    zips, stats: fStats, events: fEvents.filter((e) => e.source_key !== "hailpoint"), eventZip, jobs: fJobs, assignments, weights: settings.weights, period, today,
  }).filter((r) => zipMatch(r.zip)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [zips, fStats, fEvents, eventZip, fJobs, assignments, settings.weights, period.from, period.to, today, ql]);

  const exposures = useMemo(() => fJobs.map((j) => leadExposure(j, fSwaths, fEvents, fStats, period)).filter(Boolean) as LeadExposure[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fJobs, fSwaths, fEvents, fStats, period.from, period.to]);
  const fExposures = exposures.filter((x) => expF === "todas" || x.exposure === expF || x.followUp === expF);
  const noLocation = fJobs.filter((j) => j.lat == null);

  // ---------- Sincronización automática de reportes recientes ----------
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  useEffect(() => {
    syncRecent(false).then((r) => {
      if (!r.ok) setSyncMsg(r.error);
      else if (!r.skippedBecauseFresh && (r.inserted || r.alerts)) { setSyncMsg(`NOAA/SPC: ${r.inserted} reporte(s) nuevo(s), ${r.alerts} alerta(s).`); router.refresh(); }
    }).catch(() => setSyncMsg("No se pudo consultar NOAA/SPC ahora."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSync = props.syncJobs.find((j) => j.status === "ok" || j.status === "parcial");
  const newAlerts = props.alerts.filter((a) => a.status === "nueva");

  const tabs: [Tab, string][] = [
    ["panel", "Panel"], ["mapa", "Mapa"], ["zips", "ZIP"], ["leads", "Leads"], ["eventos", "Eventos"], ["alertas", `Alertas${newAlerts.length ? ` (${newAlerts.length})` : ""}`],
    ...(isAdmin ? [["ajustes", "Ajustes"] as [Tab, string]] : []),
  ];

  const selectZip = (zip: string) => { setSel({ kind: "zip", id: zip }); };

  return (
    <div className="space-y-4 storm-app">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-brand">Texas Top Roofing</div>
          <h1 className="h1">Storm Intelligence</h1>
          <p className="muted">Período: {fmtDate(period.from)} – {fmtDate(period.to)} · Última actualización NOAA/SPC: {lastSync ? fmtDateTime(lastSync.finished_at ?? lastSync.started_at) : "nunca"}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button type="button" className="btn-secondary px-3 min-h-[40px]" onClick={() => setShowFilters((v) => !v)}>Filtros</button>
          <button type="button" className="btn-secondary px-3 min-h-[40px]" onClick={() => window.print()} title="Imprimir o guardar como PDF">PDF</button>
        </div>
      </div>
      {syncMsg && <p className="rounded-lg bg-blue-50 text-blue-800 text-xs p-2 print:hidden">{syncMsg}</p>}

      <p className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs p-2">
        Estar en una zona de tormenta no significa que una propiedad tenga daño. Los puntajes ordenan zonas para prospectar; no son probabilidad de daño ni de aprobación del seguro. Radar = estimación; reportes NWS/SPC = observaciones puntuales.
      </p>

      {showFilters && (
        <section className="card p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 print:hidden">
          <div>
            <label className="label">Período</label>
            <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option>
              <option value="180">Últimos 6 meses</option><option value="365">Últimos 12 meses</option>
              <option value="730">Últimos 24 meses</option><option value="todo">Todo (desde {settings.history_start})</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>
          {preset === "custom" && (
            <>
              <div><label className="label">Desde</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><label className="label">Hasta</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          <div>
            <label className="label">Tipo</label>
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="ambos">Granizo y viento</option><option value="granizo">Solo granizo</option><option value="viento">Solo viento</option>
            </select>
          </div>
          <div>
            <label className="label">Granizo mínimo</label>
            <select className="input" value={minHail} onChange={(e) => setMinHail(e.target.value)}>
              {["0", "1", "1.25", "1.5", "1.75", "2", "2.5"].map((v) => <option key={v} value={v}>{v === "0" ? "Cualquiera" : `${v}"`}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Viento mínimo</label>
            <select className="input" value={minWind} onChange={(e) => setMinWind(e.target.value)}>
              {["0", "50", "58", "65", "75"].map((v) => <option key={v} value={v}>{v === "0" ? "Cualquiera" : `${v} mph`}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Fuente</label>
            <select className="input" value={fuente} onChange={(e) => setFuente(e.target.value)}>
              <option value="todas">Observados + radar</option><option value="observado">Solo observados (NWS/SPC/NOAA)</option><option value="estimado">Solo radar (estimado)</option>
            </select>
          </div>
          {props.users.length > 1 && (
            <div>
              <label className="label">Vendedor</label>
              <select className="input" value={rep} onChange={(e) => setRep(e.target.value)}>
                <option value="todos">Todos</option>{props.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Exposición del lead</label>
            <select className="input" value={expF} onChange={(e) => setExpF(e.target.value)}>
              <option value="todas">Todas</option>
              {Object.entries(EXPOSURE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              {Object.entries(FOLLOWUP_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-2 items-center">
            <button type="button" className="text-sm font-semibold text-brand" onClick={() => { navigator.clipboard?.writeText(window.location.href); setSyncMsg("Enlace de esta vista copiado. Quien lo abra verá solo los datos que su rol permite."); }}>
              Copiar enlace de esta vista
            </button>
          </div>
        </section>
      )}

      <input type="search" className="input print:hidden" placeholder="Buscar ZIP, ciudad, condado, dirección o cliente" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="flex gap-1 overflow-x-auto -mx-4 px-4 print:hidden" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`chip py-2 px-3 text-sm ${tab === k ? "bg-gray-900 text-white border-gray-900" : "bg-white"}`}>{l}</button>
        ))}
      </div>

      {tab === "panel" && <Panel scores={scores} exposures={exposures} events={fEvents} alerts={newAlerts} jobs={fJobs} users={props.users} onZip={(z) => { setTab("zips"); setQ(z); }} />}

      {tab === "mapa" && (
        <div className="lg:grid lg:grid-cols-[1fr_340px] gap-4">
          <div>
            <div className="flex flex-wrap gap-1.5 mb-2 text-xs print:hidden">
              {([["swaths", "Franjas de granizo (radar)"], ["hail", "Reportes de granizo"], ["wind", "Reportes de viento"], ["zips", "ZIP (puntaje)"], ["leads", "Leads del CRM"], ["territories", "Territorios"]] as [keyof MapLayers, string][]).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={layers[k]} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))}
                  className={`chip py-1.5 ${layers[k] ? "bg-white border-gray-400" : "bg-gray-50 text-gray-400"}`}>{layers[k] ? "✓ " : ""}{l}</button>
              ))}
            </div>
            <div className="h-[60vh] min-h-[340px]">
              <StormMap
                layers={layers}
                swaths={fSwaths.map((s) => ({ id: s.id, geom: s.geom, min: s.min_hail_in, date: s.event_date }))}
                events={fEvents.map((e) => ({ id: e.id, lat: e.lat, lng: e.lng, type: e.event_type, size: e.hail_in, label: `${e.event_type === "granizo" ? `Granizo ${e.hail_in?.toFixed(2)}"` : `Viento ${e.wind_mph ?? "s/d"} mph`} · ${e.event_date} · ${e.location_text ?? ""} · ${SOURCE_LABEL[e.source_key] ?? e.source_key}` }))}
                zips={scores.flatMap((s) => { const z = zips.find((x) => x.zip === s.zip); return z?.geom ? [{ zip: s.zip, geom: z.geom, score: s.combinedScore, label: `${s.zip} ${s.name ?? ""} · prioridad ${s.combinedScore}`, assignedTo: s.assigned }] : []; })}
                leads={exposures.filter((x) => expF === "todas" || x.exposure === expF || x.followUp === expF).map((x) => ({ id: x.job.id, lat: x.job.lat!, lng: x.job.lng!, color: EXPOSURE_COLOR[x.exposure], label: `${x.job.customer} · ${EXPOSURE_LABEL[x.exposure]}` }))}
                fitKey={`${period.from}|${period.to}|${tipo}|${minHail}|${minWind}|${fuente}|${ql}|${rep}`}
                focus={focus}
                tileUrl={props.tileUrl} tileAttribution={props.tileAttribution}
                onZip={selectZip}
                onEvent={(id) => setSel({ kind: "event", id })}
                onLead={(id) => setSel({ kind: "lead", id })}
              />
            </div>
            <MapLegend />
          </div>
          <div className="mt-3 lg:mt-0 space-y-3">
            {!sel && <p className="muted">Toca un ZIP, un reporte o un lead en el mapa para ver el detalle.</p>}
            {sel?.kind === "zip" && <ZipCard s={scores.find((x) => x.zip === sel.id)} />}
            {sel?.kind === "event" && <EventCard e={events.find((x) => x.id === sel.id)} zip={eventZip.get(sel.id) ?? null} />}
            {sel?.kind === "lead" && <LeadCard x={exposures.find((x) => x.job.id === sel.id)} />}
          </div>
        </div>
      )}

      {tab === "zips" && <ZipTable scores={scores} period={period} onMap={(zip) => {
        const z = zips.find((x) => x.zip === zip); if (z?.bbox) setFocus({ lat: (z.bbox[0] + z.bbox[2]) / 2, lng: (z.bbox[1] + z.bbox[3]) / 2, zoom: 12, key: Date.now() });
        setSel({ kind: "zip", id: zip }); setTab("mapa");
      }} />}

      {tab === "leads" && <LeadsTab list={fExposures} noLocation={noLocation} period={period} onMap={(x) => { setFocus({ lat: x.job.lat!, lng: x.job.lng!, zoom: 14, key: Date.now() }); setSel({ kind: "lead", id: x.job.id }); setTab("mapa"); }} />}

      {tab === "eventos" && <EventsTab events={fEvents} swaths={fSwaths} eventZip={eventZip} period={period} />}

      {tab === "alertas" && <AlertsTab alerts={props.alerts} settings={settings} />}

      {tab === "ajustes" && isAdmin && <SettingsTab settings={settings} assignments={assignments} users={props.users} syncJobs={props.syncJobs} zips={zips} today={today} />}

      <Methodology settings={settings} />
    </div>
  );
}

// ---------------- Panel ----------------
function Panel({ scores, exposures, events, alerts, jobs, users, onZip }: {
  scores: ZipScore[]; exposures: LeadExposure[]; events: StormEvent[]; alerts: Alert[]; jobs: StormJob[]; users: { id: string; name: string }[]; onZip: (z: string) => void;
}) {
  const hail = events.filter((e) => e.event_type === "granizo");
  const wind = events.filter((e) => e.event_type === "viento");
  const maxHail = Math.max(0, ...hail.map((e) => e.hail_in ?? 0));
  const potential = exposures.filter((x) => x.exposure === "exposicion_potencial").length;
  const recommended = exposures.filter((x) => x.followUp === "inspeccion_recomendada");
  const top = scores.filter((s) => s.exposureScore > 0).slice(0, 5);
  const perRep = users.map((u) => {
    const mine = jobs.filter((j) => j.repId === u.id);
    return { name: u.name, total: mine.length, leads: mine.filter((j) => stageOf(j.status) === "lead").length,
      insp: mine.filter((j) => stageOf(j.status) === "inspeccionado").length, apr: mine.filter((j) => stageOf(j.status) === "aprobado").length,
      firm: mine.filter((j) => stageOf(j.status) === "firmado").length,
      rec: recommended.filter((x) => x.job.repId === u.id).length };
  }).filter((r) => r.total > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Kpi label="Reportes de granizo" value={hail.length} />
        <Kpi label="Reportes de viento" value={wind.length} />
        <Kpi label="Granizo máx. observado" value={maxHail ? `${maxHail.toFixed(2)}"` : "—"} />
        <Kpi label="Leads con exposición potencial" value={potential} />
        <Kpi label="Inspecciones recomendadas" value={recommended.length} />
      </div>
      {alerts.length > 0 && (
        <section className="card p-3">
          <h2 className="font-bold mb-1">Alertas nuevas ({alerts.length})</h2>
          <ul className="text-sm space-y-1">{alerts.slice(0, 5).map((a) => <li key={a.id}>⚠ {a.title} · {a.leads_nearby} lead(s) a ≤3 mi</li>)}</ul>
        </section>
      )}
      <section className="card p-3">
        <h2 className="font-bold">Zonas prioritarias</h2>
        <p className="text-xs text-gray-500 mb-2">Recomendación por reglas con los pesos configurados (no es IA ni probabilidad de daño).</p>
        {top.length === 0 ? <p className="muted">Sin zonas con eventos en el período.</p> : (
          <ol className="space-y-2">
            {top.map((s, i) => (
              <li key={s.zip} className="text-sm">
                <button type="button" className="font-bold text-left" onClick={() => onZip(s.zip)}>{i + 1}. {s.zip} {s.name ?? ""} · prioridad {s.combinedScore}</button>
                <div className="text-gray-600">{s.reasons.slice(0, 3).join(" ")}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="card p-3">
        <h2 className="font-bold mb-2">Inspecciones recomendadas</h2>
        {recommended.length === 0 ? <p className="muted">Ningún lead abierto con exposición potencial en el período.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {recommended.slice(0, 15).map((x) => (
              <li key={x.job.id} className="py-2">
                <Link href={`/trabajos/${x.job.id}`} className="font-semibold">{x.job.customer}</Link> · {x.job.address}
                <div className="text-gray-600">{x.reason}{x.job.repName ? ` · ${x.job.repName}` : ""}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {perRep.length > 0 && (
        <section className="card p-3 overflow-x-auto">
          <h2 className="font-bold mb-2">Rendimiento por vendedor</h2>
          <table className="w-full text-sm min-w-[520px]">
            <thead className="text-xs text-gray-500 text-left"><tr><th className="py-1">Vendedor</th><th>Trabajos</th><th>Leads</th><th>Inspecc.</th><th>Aprobados</th><th>Firmados+</th><th>Insp. recomendadas</th></tr></thead>
            <tbody className="divide-y divide-gray-100">{perRep.map((r) => <tr key={r.name}><td className="py-1.5 font-semibold">{r.name}</td><td>{r.total}</td><td>{r.leads}</td><td>{r.insp}</td><td>{r.apr}</td><td>{r.firm}</td><td>{r.rec}</td></tr>)}</tbody>
          </table>
        </section>
      )}
      <section className="card p-3">
        <h2 className="font-bold mb-2">Eventos recientes</h2>
        <ul className="text-sm divide-y divide-gray-100">
          {events.slice(0, 8).map((e) => <li key={e.id} className="py-1.5">{fmtDate(e.event_date)} · {e.event_type === "granizo" ? `Granizo ${e.hail_in?.toFixed(2)}"` : `Viento ${e.wind_mph ?? "s/d"} mph`} · {e.location_text} · <span className="text-gray-500">{SOURCE_LABEL[e.source_key]}</span></li>)}
          {events.length === 0 && <li className="muted">Sin reportes en el período.</li>}
        </ul>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="card p-3"><div className="text-xl font-bold tabular-nums">{value}</div><div className="text-xs text-gray-500">{label}</div></div>;
}

function MapLegend() {
  return (
    <div className="card p-2.5 mt-2 text-xs grid grid-cols-2 gap-1.5">
      {[1.75, 2, 2.25, 2.75].map((m) => <span key={m} className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm" style={{ background: swathColor(m), opacity: 0.6 }} />Radar {m}"+ (estimado)</span>)}
      <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-gray-900 border-2 border-white shadow" />Reporte de granizo (observado)</span>
      <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow" />Reporte de viento (observado)</span>
      <span className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm bg-brand/40 border border-gray-500" />ZIP: más rojo = mayor prioridad</span>
      <span className="flex items-center gap-2"><span className="w-4 h-3 border-2 border-dashed border-gray-900" />Territorio asignado</span>
      {(Object.keys(EXPOSURE_LABEL) as Exposure[]).map((k) => <span key={k} className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: EXPOSURE_COLOR[k] }} />Lead: {EXPOSURE_LABEL[k]}</span>)}
    </div>
  );
}

function ScoreBar({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><b className="tabular-nums">{v}</b></div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-brand" style={{ width: `${v}%` }} /></div>
    </div>
  );
}

function ZipCard({ s }: { s?: ZipScore }) {
  if (!s) return null;
  return (
    <section className="card p-3 space-y-2">
      <div className="font-bold">{s.zip} {s.name}</div>
      <ScoreBar label="Prioridad combinada" v={s.combinedScore} />
      <ScoreBar label="Storm Exposure" v={s.exposureScore} />
      <ScoreBar label="Oportunidad comercial" v={s.commercialScore} />
      <ScoreBar label="Confianza de los datos" v={s.confidenceScore} />
      <ul className="text-sm text-gray-700 list-disc ml-4 space-y-0.5">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <ul className="text-xs text-gray-500 list-disc ml-4">{s.confidenceNotes.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </section>
  );
}

function EventCard({ e, zip }: { e?: StormEvent; zip: string | null }) {
  if (!e) return null;
  return (
    <section className="card p-3 space-y-1 text-sm">
      <div className="font-bold">{e.event_type === "granizo" ? `Granizo ${e.hail_in?.toFixed(2)} pulgadas` : `Viento ${e.wind_mph ?? "sin velocidad medida"}${e.wind_mph ? " mph" : ""}`}</div>
      <div>{fmtDate(e.event_date)}{e.observed_at ? ` · ${fmtDateTime(e.observed_at)} (hora del reporte)` : ""}</div>
      <div>{e.location_text}{e.county ? ` · condado ${e.county}` : ""}{zip ? ` · ZIP ${zip}` : ""}</div>
      <div className="text-gray-600">Fuente: {SOURCE_LABEL[e.source_key] ?? e.source_key} · calidad: {e.data_quality}</div>
      {e.precision_note && <div className="text-xs text-gray-500">{e.precision_note}</div>}
      <div className="text-xs text-gray-500">Reporte puntual: no indica el área afectada ni daño en una propiedad específica.</div>
    </section>
  );
}

function LeadCard({ x }: { x?: LeadExposure }) {
  if (!x) return null;
  return (
    <section className="card p-3 space-y-1.5 text-sm">
      <Link href={`/trabajos/${x.job.id}`} className="font-bold">{x.job.customer}</Link>
      <div className="text-gray-600">{x.job.address}</div>
      <div className="flex flex-wrap gap-1.5">
        <span className="chip text-white border-transparent" style={{ background: EXPOSURE_COLOR[x.exposure] }}>{EXPOSURE_LABEL[x.exposure]}</span>
        {x.followUp && <span className="chip bg-gray-100 border-gray-200">{FOLLOWUP_LABEL[x.followUp]}</span>}
        <span className="chip bg-gray-100 border-gray-200">{statusInfo(x.job.status).label}</span>
      </div>
      <p>{x.reason}</p>
      {x.swathHits.length > 0 && <p className="text-xs">Franjas de radar que cubren la propiedad: {x.swathHits.slice(0, 4).map((s) => `${s.min.toFixed(2)}"+ (${s.date})`).join(", ")}</p>}
      {x.near.length > 0 && <p className="text-xs">Reportes a ≤3 mi: {x.near.slice(0, 4).map((n) => `${(n.distM / 1609).toFixed(1)} mi · ${n.type === "granizo" ? `${n.hail}"` : `${n.wind ?? "s/d"} mph`} · ${n.date}`).join(" | ")}</p>}
      <p className="text-xs text-gray-500">Vendedor: {x.job.repName ?? "Sin asignar"}. El estado de daño solo cambia con una inspección o un reclamo aprobado en el trabajo.</p>
    </section>
  );
}

// ---------------- ZIP ----------------
function ZipTable({ scores, period, onMap }: { scores: ZipScore[]; period: { from: string; to: string }; onMap: (z: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const exportCsv = () => download(`ranking-zip_${period.from}_${period.to}.csv`, toCsv([
    ["rank", "zip", "zona", "prioridad", "storm_exposure", "oportunidad_comercial", "confianza", "dias_con_evento", "ultimo_evento", "radar_max_in", "pct_zip_175", "reportes_granizo", "granizo_max_obs_in", "reportes_viento", "viento_max_mph", "trabajos", "leads_abiertos", "inspeccionados", "aprobados", "firmados", "asignado", "explicacion"],
    ...scores.map((s, i) => [i + 1, s.zip, s.name, s.combinedScore, s.exposureScore, s.commercialScore, s.confidenceScore, s.eventDays, s.lastEvent, s.radarMax || "", Math.round(s.bestF175 * 100), s.hailReports, s.hailMax || "", s.windReports, s.windMax || "", s.jobs, s.openLeads, s.inspected, s.approved, s.signed, s.assigned, s.reasons.join(" ")]),
    [], ["Período", `${period.from} a ${period.to}`], ["Fuentes", "NOAA/SPC reportes preliminares; reportes NWS/NOAA compilados; HailPoint radar (estimado); Census ZCTA"],
    ["Advertencia", "El puntaje ordena zonas para prospectar. No es probabilidad de daño ni de aprobación del seguro."],
  ]));
  return (
    <section className="space-y-2">
      <div className="flex justify-between items-center print:hidden">
        <p className="muted">{scores.length} ZIP · ordenados por prioridad combinada</p>
        <button type="button" className="btn-secondary px-3 min-h-[36px]" onClick={exportCsv}>CSV</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="text-xs text-gray-500 text-left"><tr>
            <th className="p-2">#</th><th>ZIP</th><th>Prioridad</th><th>Exposición</th><th>Comercial</th><th>Confianza</th><th>Último evento</th><th>Radar máx.</th><th>Obs. máx.</th><th>Leads</th><th>Asignado</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {scores.map((s, i) => (
              <Fragment key={s.zip}>
                <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === s.zip ? null : s.zip)}>
                  <td className="p-2 text-gray-500">{i + 1}</td>
                  <td className="font-semibold">{s.zip}<div className="text-xs font-normal text-gray-500">{s.name}</div></td>
                  <td className="font-bold tabular-nums">{s.combinedScore}</td><td className="tabular-nums">{s.exposureScore}</td><td className="tabular-nums">{s.commercialScore}</td><td className="tabular-nums">{s.confidenceScore}</td>
                  <td>{s.lastEvent ? fmtDate(s.lastEvent) : "—"}</td><td>{s.radarMax ? `${s.radarMax.toFixed(2)}"` : "—"}</td><td>{s.hailMax ? `${s.hailMax.toFixed(2)}"` : "—"}</td>
                  <td>{s.openLeads}/{s.jobs}</td><td className="text-xs">{s.assigned ?? "—"}</td>
                </tr>
                {open === s.zip && (
                  <tr><td colSpan={11} className="p-3 bg-gray-50">
                    <ul className="list-disc ml-4 space-y-0.5">{s.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>
                    <ul className="list-disc ml-4 text-xs text-gray-500 mt-1">{s.confidenceNotes.map((r, k) => <li key={k}>{r}</li>)}</ul>
                    <button type="button" className="text-brand font-semibold text-sm mt-2" onClick={() => onMap(s.zip)}>Ver en el mapa</button>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- Leads ----------------
function LeadsTab({ list, noLocation, period, onMap }: { list: LeadExposure[]; noLocation: StormJob[]; period: { from: string; to: string }; onMap: (x: LeadExposure) => void }) {
  const order: Record<string, number> = { exposicion_potencial: 0, historica_cerca: 1, sin_evidencia: 2 };
  const sorted = [...list].sort((a, b) => order[a.exposure] - order[b.exposure]);
  const exportCsv = () => download(`exposicion-leads_${period.from}_${period.to}.csv`, toCsv([
    ["trabajo", "cliente", "direccion", "zip", "estado_crm", "vendedor", "exposicion", "seguimiento", "motivo", "franjas_radar", "reporte_mas_cercano_mi", "fecha_reporte"],
    ...sorted.map((x) => [x.job.number, x.job.customer, x.job.address, x.job.zip, statusInfo(x.job.status).label, x.job.repName, EXPOSURE_LABEL[x.exposure], x.followUp ? FOLLOWUP_LABEL[x.followUp] : "", x.reason,
      x.swathHits.map((s) => `${s.min}"+ ${s.date}`).join("; "), x.near[0] ? (x.near[0].distM / 1609).toFixed(2) : "", x.near[0]?.date ?? ""]),
    [], ["Advertencia", "Exposición = cercanía a reportes o franjas de radar. No confirma daño; el daño solo se documenta con inspección o reclamo aprobado."],
  ]));
  return (
    <section className="space-y-2">
      <div className="flex justify-between items-center print:hidden">
        <p className="muted">{list.length} lead(s) con ubicación{noLocation.length ? ` · ${noLocation.length} sin ubicación (ver Mapa → Por revisar)` : ""}</p>
        <button type="button" className="btn-secondary px-3 min-h-[36px]" onClick={exportCsv}>CSV</button>
      </div>
      <ul className="space-y-2">
        {sorted.map((x) => (
          <li key={x.job.id} className="card p-3 text-sm space-y-1">
            <div className="flex justify-between gap-2">
              <Link href={`/trabajos/${x.job.id}`} className="font-bold">{x.job.customer}</Link>
              <button type="button" className="text-xs text-brand font-semibold print:hidden" onClick={() => onMap(x)}>Mapa</button>
            </div>
            <div className="text-gray-600">{x.job.address} · {statusInfo(x.job.status).label}{x.job.repName ? ` · ${x.job.repName}` : ""}</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="chip text-white border-transparent" style={{ background: EXPOSURE_COLOR[x.exposure] }}>{EXPOSURE_LABEL[x.exposure]}</span>
              {x.followUp && <span className="chip bg-gray-100 border-gray-200">{FOLLOWUP_LABEL[x.followUp]}</span>}
            </div>
            <div className="text-gray-700">{x.reason}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- Eventos ----------------
function EventsTab({ events, swaths, eventZip, period }: { events: StormEvent[]; swaths: Swath[]; eventZip: Map<string, string | null>; period: { from: string; to: string } }) {
  const radarDays = Array.from(new Set(swaths.map((s) => s.event_date))).sort().reverse();
  const exportCsv = () => download(`eventos_${period.from}_${period.to}.csv`, toCsv([
    ["fecha_local", "hora_reporte_utc", "tipo", "granizo_in", "viento_mph", "lugar", "condado", "zip", "lat", "lng", "fuente", "calidad", "nota"],
    ...events.map((e) => [e.event_date, e.observed_at ?? "", e.event_type, e.hail_in ?? "", e.wind_mph ?? "", e.location_text, e.county, eventZip.get(e.id) ?? e.zip, e.lat, e.lng, SOURCE_LABEL[e.source_key] ?? e.source_key, e.data_quality, e.precision_note]),
    [], ["Unidades", "Granizo en pulgadas; viento en mph. Fecha local = hora de Texas."],
    ["Advertencia", "Reportes puntuales preliminares; pueden corregirse en NOAA Storm Events. No indican áreas ni daños."],
  ]));
  return (
    <section className="space-y-3">
      <div className="flex justify-between items-center print:hidden">
        <p className="muted">{events.length} reporte(s) observados · {radarDays.length} día(s) con franjas de radar</p>
        <button type="button" className="btn-secondary px-3 min-h-[36px]" onClick={exportCsv}>CSV</button>
      </div>
      {radarDays.length > 0 && <p className="text-sm">Días con franjas de radar (HailPoint, estimado): {radarDays.map((d) => fmtDate(d)).join(", ")}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="text-xs text-gray-500 text-left"><tr><th className="p-2">Fecha</th><th>Tipo</th><th>Magnitud</th><th>Lugar</th><th>ZIP</th><th>Fuente</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {events.slice(0, 500).map((e) => (
              <tr key={e.id}>
                <td className="p-2 whitespace-nowrap">{fmtDate(e.event_date)}</td><td>{e.event_type}</td>
                <td>{e.event_type === "granizo" ? `${e.hail_in?.toFixed(2)}"` : e.wind_mph ? `${e.wind_mph} mph` : "s/d"}</td>
                <td>{e.location_text}{e.county ? ` (${e.county})` : ""}</td><td>{eventZip.get(e.id) ?? e.zip ?? "—"}</td>
                <td className="text-xs">{SOURCE_LABEL[e.source_key] ?? e.source_key}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {events.length > 500 && <p className="muted">Mostrando 500 de {events.length}. Descarga el CSV para verlos todos.</p>}
    </section>
  );
}

// ---------------- Alertas ----------------
function AlertsTab({ alerts, settings }: { alerts: Alert[]; settings: Settings }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section className="space-y-2">
      <p className="text-sm text-gray-600">
        Se crea una alerta por cada reporte nuevo de NOAA/SPC con granizo ≥ {settings.alert_min_hail_in}" o viento ≥ {settings.alert_min_wind_mph} mph en el área de cobertura (una sola vez por reporte).
        Son reportes publicados después de observarse, no alertas oficiales en tiempo real del NWS.
      </p>
      {alerts.length === 0 ? <p className="muted">Sin alertas todavía.</p> : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className={`card p-3 text-sm ${a.status === "nueva" ? "border-red-300" : "opacity-70"}`}>
              <div className="font-semibold">{a.title}</div>
              <div className="text-gray-600">ZIP cercanos: {a.zips.join(", ") || "—"} · {a.leads_nearby} trabajo(s) del CRM a ≤3 mi</div>
              <div className="text-xs text-gray-500">Observado: {a.event?.event_date ?? "—"} · registrado en el CRM: {fmtDateTime(a.created_at)} · {a.is_realtime ? "tiempo real" : "reporte publicado después"}</div>
              {a.status === "nueva" ? (
                <button type="button" disabled={pending} className="btn-secondary min-h-[36px] px-3 mt-2"
                  onClick={() => start(async () => { await reviewAlert(a.id); router.refresh(); })}>Marcar revisada</button>
              ) : <div className="text-xs text-gray-500 mt-1">Revisada</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- Ajustes (admin) ----------------
function SettingsTab({ settings, assignments, users, syncJobs, zips, today }: {
  settings: Settings; assignments: Assignment[]; users: { id: string; name: string; role: string }[]; syncJobs: SyncJob[]; zips: ZipInfo[]; today: string;
}) {
  const router = useRouter();
  const [w, setW] = useState<Weights>(settings.weights);
  const [hail, setHail] = useState(String(settings.alert_min_hail_in));
  const [wind, setWind] = useState(String(settings.alert_min_wind_mph));
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [aZip, setAZip] = useState(""); const [aRep, setARep] = useState(""); const [aDate, setADate] = useState(today);
  const [hist, setHist] = useState<{ running: boolean; at: string | null; inserted: number; err: string | null }>({ running: false, at: null, inserted: 0, err: null });
  const [pending, start] = useTransition();
  const total = Object.values(w).reduce((a, b) => a + Number(b || 0), 0);

  async function runHistory() {
    setHist({ running: true, at: settings.history_start, inserted: 0, err: null });
    let next: string | null = settings.history_start, ins = 0;
    while (next) {
      const r = await syncHistoryBatch(next).catch(() => null);
      if (!r || !r.ok) { setHist((h) => ({ ...h, running: false, err: r && !r.ok ? r.error : "Se interrumpió la importación. Puedes reanudarla." })); router.refresh(); return; }
      ins += r.inserted; next = r.next;
      setHist({ running: !!next, at: r.to, inserted: ins, err: null });
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="card p-3 space-y-2">
        <h2 className="font-bold">Pesos del Storm Opportunity Score</h2>
        <p className="text-xs text-gray-500">Configuración inicial, no un modelo validado científicamente. Suma actual: {total} (se normaliza).</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm">
              <span>{WEIGHT_LABELS[k]}</span>
              <input type="number" min={0} max={100} className="input w-20" value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <h3 className="font-semibold text-sm pt-2">Umbrales de alerta</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Granizo mínimo (pulgadas)<input className="input" inputMode="decimal" value={hail} onChange={(e) => setHail(e.target.value)} /></label>
          <label className="text-sm">Viento mínimo (mph)<input className="input" inputMode="numeric" value={wind} onChange={(e) => setWind(e.target.value)} /></label>
        </div>
        <button type="button" className="btn-primary" disabled={pending} onClick={() => start(async () => {
          const r = await saveStormSettings({ weights: w, alert_min_hail_in: Number(hail), alert_min_wind_mph: Number(wind) });
          setMsg(r.ok ? { ok: true, t: "Guardado." } : { ok: false, t: r.error }); if (r.ok) router.refresh();
        })}>Guardar</button>
        {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.t}</p>}
      </section>

      <section className="card p-3 space-y-2">
        <h2 className="font-bold">Territorios por ZIP</h2>
        <p className="text-xs text-gray-500">Un ZIP solo puede tener una asignación activa. Asignar un ZIP no significa que todas las casas sean prospectos disponibles.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input className="input" list="ziplist" placeholder="ZIP" inputMode="numeric" value={aZip} onChange={(e) => setAZip(e.target.value.replace(/\D/g, "").slice(0, 5))} />
          <datalist id="ziplist">{zips.map((z) => <option key={z.zip} value={z.zip}>{z.name}</option>)}</datalist>
          <select className="input" value={aRep} onChange={(e) => setARep(e.target.value)}>
            <option value="">Vendedor…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input type="date" className="input" value={aDate} onChange={(e) => setADate(e.target.value)} />
          <button type="button" className="btn-primary" disabled={pending} onClick={() => start(async () => {
            const r = await assignZip({ zip: aZip, repId: aRep, startsOn: aDate });
            setMsg(r.ok ? { ok: true, t: `ZIP ${aZip} asignado.` } : { ok: false, t: r.error }); if (r.ok) { setAZip(""); router.refresh(); }
          })}>Asignar</button>
        </div>
        <ul className="divide-y divide-gray-100 text-sm">
          {assignments.map((a) => (
            <li key={a.id} className="py-2 flex justify-between gap-2">
              <span><b>{a.zip}</b> · {a.rep_name} · desde {fmtDate(a.starts_on)}{a.ends_on ? ` hasta ${fmtDate(a.ends_on)}` : " (activa)"}</span>
              {!a.ends_on && <button type="button" className="text-xs text-red-600" onClick={() => start(async () => { await endAssignment(a.id); router.refresh(); })}>Terminar</button>}
            </li>
          ))}
          {assignments.length === 0 && <li className="muted py-2">Sin asignaciones.</li>}
        </ul>
      </section>

      <section className="card p-3 space-y-2">
        <h2 className="font-bold">Datos de NOAA/SPC</h2>
        <p className="text-xs text-gray-500">Reportes preliminares de granizo y viento en el área San Antonio–Temple. Se actualizan solos al abrir esta página (cada 6 h como máximo).</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => start(async () => {
            const r = await syncRecent(true); setMsg(r.ok ? { ok: true, t: `Listo: ${r.inserted} reporte(s) nuevo(s), ${r.alerts} alerta(s).` } : { ok: false, t: r.error }); router.refresh();
          })}>Actualizar ahora</button>
          <button type="button" className="btn-secondary" disabled={hist.running} onClick={runHistory}>
            {hist.running ? `Importando… ${hist.at ?? ""}` : `Importar historial desde ${fmtDate(settings.history_start)}`}
          </button>
        </div>
        {(hist.inserted > 0 || hist.err || hist.running) && (
          <p className={`text-sm ${hist.err ? "text-red-700" : "text-gray-700"}`}>{hist.err ?? `${hist.inserted} reporte(s) importados hasta ${hist.at}.`}{!hist.running && !hist.err && hist.at ? " Terminado." : ""}</p>
        )}
        <ul className="text-xs divide-y divide-gray-100">
          {syncJobs.map((j) => (
            <li key={j.id} className="py-1.5">{fmtDateTime(j.started_at)} · {j.range_start} → {j.range_end} · <b>{j.status}</b> · {j.inserted} nuevos, {j.skipped} ya existían{j.error ? ` · ${j.error}` : ""}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Methodology({ settings }: { settings: Settings }) {
  return (
    <section className="card p-3 text-xs text-gray-600">
      <h2 className="font-semibold text-sm text-gray-800">Metodología, fuentes y limitaciones</h2>
      <ul className="list-disc ml-4 mt-2 space-y-1">
        <li><b>Observados:</b> reportes locales de tormenta de NOAA/SPC (preliminares, puntos con hora UTC) y reportes NWS/NOAA compilados en la investigación inicial (nov-2024 a nov-2026). Granizo en pulgadas, viento en mph.</li>
        <li><b>Estimados:</b> franjas de granizo ≥1.75" y porcentaje de cada ZIP con granizo estimado (≥1", ≥1.75", ≥2.5") de HailPoint por radar. No son mediciones en tierra y cubren las fechas descargadas de HailPoint.</li>
        <li><b>ZIP:</b> contornos ZCTA del Censo simplificados (61 ZIP con contorno). Un reporte se asigna al ZIP cuyo contorno lo contiene.</li>
        <li><b>Storm Opportunity Score:</b> intensidad {settings.weights.intensidad}, frecuencia {settings.weights.frecuencia}, recencia {settings.weights.recencia}, resultados {settings.weights.resultados}, leads {settings.weights.leads}, cobertura {settings.weights.cobertura}. Intensidad usa fracciones del ZIP (no su tamaño) para no favorecer ZIP grandes. Las métricas comerciales usan solo los trabajos que tu usuario puede ver.</li>
        <li><b>Exposición de leads:</b> “Exposición potencial” = dentro de una franja de radar o reporte de granizo ≥1"/viento ≥58 mph a ≤1 mi. “Histórica cerca” = reporte a ≤3 mi o radar ≥1" en parte del ZIP. El daño solo se marca con inspección o reclamo aprobado en el CRM.</li>
        <li>Generado el {new Date().toLocaleString("es-US", { timeZone: "America/Chicago" })} (hora de Texas).</li>
      </ul>
    </section>
  );
}
