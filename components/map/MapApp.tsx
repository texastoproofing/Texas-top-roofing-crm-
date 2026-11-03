"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MAP_GROUPS, STREET_STATUS, appleDirUrl, chunkStops, distanceM, fmtDistance, googleDirUrl, groupInfo,
  type LatLng, type MapGroup,
} from "@/lib/map";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { statusInfo } from "@/lib/constants";
import {
  addStreetVisit, chooseCandidate, deleteStreetVisit, geocodePending, geocodeStart, getNearby, getRoute,
  getStreetVisits, loadStreetGeometry, retryGeocode, saveRoute, setManualLocation,
  type NearbyRef, type RoutePayload,
} from "@/app/(app)/mapa/actions";
import type { Bounds } from "./LeafletMap";

const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-xl bg-gray-100 flex items-center justify-center text-sm text-gray-500">Cargando mapa…</div>,
});

export type MapPoint = {
  id: string; number: number; name: string; customer: string; address: string; zip: string | null;
  status: string; statusLabel: string; group: MapGroup; repId: string | null; repName: string | null;
  territoryId: string | null; lat: number | null; lng: number | null;
  locStatus: "ok" | "ambigua" | "sin_resultado" | "error" | "pendiente" | "sin_direccion";
  locSource: string | null; matched: string | null; candidates: { label: string; lat: number; lng: number }[];
  locError: string | null; nextActivity: { when: string | null; label: string } | null; lastVisit: string | null;
  referenceAuthorized: boolean;
};
export type MapStreet = {
  id: string; name: string; territoryId: string; territoryCode: string; status: string;
  lines: [number, number][][]; geomStatus: string; lastVisit: string | null; lastVisitBy: string | null;
  doors: number; leads: number; visits: number;
};
type Territory = { id: string; code: string; name: string; city: string | null; zip: string | null };
type Route = RoutePayload & { owner_id?: string; updated_at?: string };

const DEFAULT_GROUPS: MapGroup[] = ["nuevo", "contactado", "seguimiento", "firmado", "proceso", "terminado"];

function daysAgo(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}
function matchVisit(filter: string, last: string | null) {
  const n = daysAgo(last);
  if (filter === "todas") return true;
  if (filter === "sin") return n === null;
  if (filter === "7") return n !== null && n <= 7;
  if (filter === "30") return n !== null && n <= 30;
  if (filter === "mas30") return n !== null && n > 30;
  return true;
}

export function MapApp(props: {
  me: string; staff: boolean; points: MapPoint[]; streets: MapStreet[]; territories: Territory[];
  users: { id: string; name: string }[]; pendingGeocode: number; territoriesPendingGeom: string[];
  initialRoute: Route | null; today: string; tileUrl: string; tileAttribution: string;
}) {
  const { points, streets, territories, users, staff } = props;
  const router = useRouter();
  const [tab, setTab] = useState<"mapa" | "ruta" | "revisar">("mapa");
  const [showFilters, setShowFilters] = useState(false);
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("todos");
  const [groups, setGroups] = useState<MapGroup[]>(DEFAULT_GROUPS);
  const [visitF, setVisitF] = useState("todas");
  const [zone, setZone] = useState("todas");
  const [showStreets, setShowStreets] = useState(true);
  const [onlyInView, setOnlyInView] = useState(true);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selStreet, setSelStreet] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom?: number; key: number } | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<LatLng | null>(null);
  const [bg, setBg] = useState<{ geocoding: number; streets: number; msg: string | null }>({ geocoding: props.pendingGeocode, streets: props.territoriesPendingGeom.length, msg: null });

  // ---------------- Ruta del día ----------------
  const emptyRoute = (date: string): Route => ({ date, start_mode: "ninguno", start_label: null, start_lat: null, start_lng: null, stops: [], order_mode: "manual" });
  const [route, setRoute] = useState<Route>(props.initialRoute ?? emptyRoute(props.today));
  const [routeDate, setRouteDate] = useState(props.today);
  const [saveState, setSaveState] = useState<"guardado" | "guardando" | "error" | "sin_cambios">("sin_cambios");
  const [savedAt, setSavedAt] = useState<string | null>(props.initialRoute?.updated_at ?? null);
  const dirty = useRef(false);

  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const routeIndex = useMemo(() => new Map(route.stops.map((id, i) => [id, i])), [route.stops]);

  // ---------------- Trabajos en segundo plano: ubicar direcciones y trazar calles ----------------
  useEffect(() => {
    let stop = false;
    (async () => {
      let remaining = props.pendingGeocode;
      for (let i = 0; i < 30 && remaining > 0 && !stop; i++) {
        const r = await geocodePending(12).catch(() => null);
        if (!r || !r.ok) { setBg((b) => ({ ...b, msg: "No se pudieron ubicar algunas direcciones ahora. Se reintentará al volver a abrir el mapa." })); break; }
        remaining = r.remaining;
        setBg((b) => ({ ...b, geocoding: remaining }));
        router.refresh();
        if (r.processed === 0) break;
      }
      for (const [i, t] of props.territoriesPendingGeom.entries()) {
        if (stop) break;
        // Pausa entre zonas para respetar el límite de los servidores públicos de OpenStreetMap
        if (i > 0) await new Promise((res) => setTimeout(res, 3000));
        const r = await loadStreetGeometry(t).catch(() => null);
        setBg((b) => ({ ...b, streets: Math.max(0, b.streets - 1), msg: r && !r.ok ? r.error : b.msg }));
      }
      if (props.territoriesPendingGeom.length) router.refresh();
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------- Filtros ----------------
  const ql = q.trim().toLowerCase();
  const filtered = useMemo(() => points.filter((p) => {
    if (!groups.includes(p.group)) return false;
    if (rep !== "todos" && p.repId !== rep) return false;
    if (zone !== "todas" && p.territoryId !== zone) return false;
    if (!matchVisit(visitF, p.lastVisit)) return false;
    if (ql && !(`${p.customer} ${p.name} ${p.address} ${p.zip ?? ""} #${p.number}`.toLowerCase().includes(ql))) return false;
    return true;
  }), [points, groups, rep, zone, visitF, ql]);

  const located = filtered.filter((p) => p.lat != null && p.lng != null);
  const toReview = points.filter((p) => p.lat == null);
  const streetsShown = useMemo(() => streets.filter((s) => {
    if (zone !== "todas" && s.territoryId !== zone) return false;
    if (!matchVisit(visitF, s.lastVisit)) return false;
    if (ql && !(`${s.name} ${s.territoryCode}`.toLowerCase().includes(ql))) return false;
    return s.lines.length > 0;
  }), [streets, zone, visitF, ql]);

  const inView = (p: MapPoint) => !bounds || (p.lat! >= bounds.s && p.lat! <= bounds.n && p.lng! >= bounds.w && p.lng! <= bounds.e);
  const listItems = (onlyInView ? located.filter(inView) : located)
    .sort((a, b) => (groupInfo(b.group).reference ? 1 : 0) - (groupInfo(a.group).reference ? 1 : 0) || a.customer.localeCompare(b.customer));

  const fitKey = `${groups.join()}|${rep}|${zone}|${visitF}|${ql}|${showStreets}|${located.length}`;
  const sel = selected ? byId.get(selected) ?? null : null;
  const selS = selStreet ? streets.find((s) => s.id === selStreet) ?? null : null;

  const selectPoint = useCallback((id: string, fly = false) => {
    setSelected(id); setSelStreet(null);
    const p = byId.get(id);
    if (fly && p?.lat != null) setFocus({ lat: p.lat, lng: p.lng!, key: Date.now() });
  }, [byId]);

  // ---------------- Ruta: cambios y guardado ----------------
  const updateRoute = (fn: (r: Route) => Route) => { dirty.current = true; setRoute((r) => fn(r)); };
  const toggleStop = (id: string) => updateRoute((r) => ({
    ...r, order_mode: "manual",
    stops: r.stops.includes(id) ? r.stops.filter((x) => x !== id) : [...r.stops, id],
  }));

  useEffect(() => {
    if (!dirty.current) return;
    setSaveState("guardando");
    const t = setTimeout(async () => {
      const r = await saveRoute({ ...route, date: routeDate }).catch(() => null);
      if (r && r.ok) { setSaveState("guardado"); setSavedAt(r.updated_at); dirty.current = false; }
      else setSaveState("error");
    }, 700);
    return () => clearTimeout(t);
  }, [route, routeDate]);

  async function loadRouteFor(date: string) {
    setRouteDate(date);
    const r = await getRoute(date);
    dirty.current = false;
    if (r.ok) { setRoute(r.route ?? emptyRoute(date)); setSavedAt(r.route?.updated_at ?? null); setSaveState("sin_cambios"); }
    else setSaveState("error");
  }

  const startLL: LatLng | null = route.start_lat != null && route.start_lng != null ? { lat: route.start_lat, lng: route.start_lng } : null;

  return (
    <div className="-mx-4 -my-5 lg:mx-0 lg:my-0">
      {/* Encabezado y pestañas */}
      <div className="px-4 pt-4 lg:px-0 lg:pt-0">
        <div className="flex items-center justify-between gap-2">
          <h1 className="h1">Mapa</h1>
          <button type="button" className="btn-secondary px-3 min-h-[40px]" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            Filtros{(rep !== "todos" || zone !== "todas" || visitF !== "todas" || groups.length !== DEFAULT_GROUPS.length) ? " •" : ""}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold" role="tablist">
          {([["mapa", "Mapa"], ["ruta", `Ruta (${route.stops.length})`], ["revisar", `Por revisar (${toReview.length})`]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-lg py-2 ${tab === k ? "bg-white shadow text-gray-900" : "text-gray-600"}`}>{l}</button>
          ))}
        </div>
        {(bg.geocoding > 0 || bg.streets > 0 || bg.msg) && (
          <p className={`mt-2 rounded-lg p-2 text-xs ${bg.msg ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`} role="status">
            {bg.geocoding > 0 && `Ubicando direcciones… faltan ${bg.geocoding}. `}
            {bg.streets > 0 && `Trazando calles de ${bg.streets} zona(s)… `}
            {bg.msg}
          </p>
        )}
      </div>

      {/* Filtros */}
      {showFilters && (
        <section className="mx-4 lg:mx-0 mt-3 card p-3 space-y-3">
          <div>
            <span className="label">Estado</span>
            <div className="flex flex-wrap gap-1.5">
              {MAP_GROUPS.map((g) => {
                const on = groups.includes(g.key);
                return (
                  <button key={g.key} type="button" aria-pressed={on}
                    onClick={() => setGroups((gs) => on ? gs.filter((x) => x !== g.key) : [...gs, g.key])}
                    className={`chip py-1.5 gap-1.5 ${on ? "bg-white border-gray-400" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: on ? g.color : "#d1d5db" }} />{g.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {staff && (
              <div>
                <label className="label" htmlFor="f-rep">Vendedor</label>
                <select id="f-rep" className="input" value={rep} onChange={(e) => setRep(e.target.value)}>
                  <option value="todos">Todos</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="f-zone">Zona</label>
              <select id="f-zone" className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="todas">Todas</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="f-visit">Última visita</label>
              <select id="f-visit" className="input" value={visitF} onChange={(e) => setVisitF(e.target.value)}>
                <option value="todas">Cualquiera</option>
                <option value="7">Últimos 7 días</option>
                <option value="30">Últimos 30 días</option>
                <option value="mas30">Hace más de 30 días</option>
                <option value="sin">Sin visitas</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold mt-6">
              <input type="checkbox" className="w-5 h-5" checked={showStreets} onChange={(e) => setShowStreets(e.target.checked)} /> Mostrar calles
            </label>
          </div>
          <p className="text-xs text-gray-500">“Última visita” usa las visitas registradas en el trabajo (notas tipo Visita) y en las calles.</p>
        </section>
      )}

      <div className="px-4 lg:px-0 mt-3">
        <input type="search" className="input" placeholder="Buscar nombre, dirección o ZIP" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
      </div>

      {tab === "mapa" && (
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:gap-4 mt-3">
          <div className="px-4 lg:px-0">
            {pickFor && (
              <div className="mb-2 rounded-lg bg-gray-900 text-white text-sm p-3">
                <p className="font-semibold">Toca en el mapa el punto exacto de la propiedad de {byId.get(pickFor)?.customer}.</p>
                {picked ? (
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="btn min-h-[36px] px-3 bg-brand text-white" onClick={async () => {
                      const r = await setManualLocation(pickFor, picked.lat, picked.lng);
                      if (!r.ok) alertMsg(r.error); else { setPickFor(null); setPicked(null); router.refresh(); }
                    }}>Guardar ubicación aquí</button>
                    <button type="button" className="btn min-h-[36px] px-3 bg-white/15" onClick={() => setPicked(null)}>Elegir otro punto</button>
                  </div>
                ) : null}
                <button type="button" className="underline text-xs mt-2" onClick={() => { setPickFor(null); setPicked(null); }}>Cancelar</button>
              </div>
            )}
            <div className="h-[58vh] lg:h-[calc(100vh-260px)] min-h-[320px]">
              <LeafletMap
                points={located.map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng!, group: p.group, label: `${p.customer} — ${p.statusLabel}`, routeIndex: routeIndex.get(p.id) ?? null, authorized: p.referenceAuthorized }))}
                streets={streetsShown.map((s) => ({ id: s.id, status: s.status, visits: s.visits, lines: s.lines, label: `${s.name} (${s.territoryCode})` }))}
                showStreets={showStreets}
                selectedId={selected}
                selectedStreetId={selStreet}
                start={pickFor ? picked : startLL}
                pickMode={!!pickFor}
                focus={focus}
                fitKey={fitKey}
                tileUrl={props.tileUrl}
                tileAttribution={props.tileAttribution}
                onSelect={(id) => selectPoint(id)}
                onSelectStreet={(id) => { setSelStreet(id); setSelected(null); }}
                onPick={(p) => setPicked(p)}
                onBounds={setBounds}
              />
            </div>
            <Legend />
          </div>

          <div className="px-4 lg:px-0 mt-3 lg:mt-0 space-y-3 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
            {sel && <PointCard p={sel} inRoute={routeIndex.has(sel.id)} onToggleRoute={() => toggleStop(sel.id)} onClose={() => setSelected(null)} />}
            {selS && <StreetCard s={selS} me={props.me} onClose={() => setSelStreet(null)} onSaved={() => router.refresh()} />}

            <div className="flex items-center justify-between">
              <h2 className="font-bold">{listItems.length} en {onlyInView ? "esta vista" : "total"}</h2>
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                <input type="checkbox" checked={onlyInView} onChange={(e) => setOnlyInView(e.target.checked)} /> Solo lo visible
              </label>
            </div>
            {listItems.length === 0 ? (
              <p className="muted">No hay registros con ubicación en esta vista. Aleja el mapa o cambia los filtros.</p>
            ) : (
              <ul className="card divide-y divide-gray-100">
                {listItems.slice(0, 150).map((p) => {
                  const g = groupInfo(p.group);
                  return (
                    <li key={p.id} className={`flex items-center gap-2 p-2.5 ${p.id === selected ? "bg-brand-soft" : ""}`}>
                      <button type="button" className="flex-1 min-w-0 text-left flex items-center gap-2.5" onClick={() => selectPoint(p.id, true)}>
                        <span className={`shrink-0 rounded-full border-2 ${g.reference ? "w-5 h-5 border-yellow-400" : "w-4 h-4 border-white"}`} style={{ background: g.color }} />
                        <span className="min-w-0">
                          <span className="block font-semibold truncate">{p.customer}</span>
                          <span className="block text-xs text-gray-500 truncate">{p.address}</span>
                          <span className="block text-xs text-gray-500">{p.statusLabel}{p.repName ? ` · ${p.repName}` : ""}</span>
                        </span>
                      </button>
                      <button type="button" onClick={() => toggleStop(p.id)} aria-pressed={routeIndex.has(p.id)}
                        className={`shrink-0 rounded-lg border px-2.5 py-2 text-xs font-bold ${routeIndex.has(p.id) ? "bg-brand text-white border-brand" : "bg-white border-gray-300"}`}>
                        {routeIndex.has(p.id) ? `Ruta ${routeIndex.get(p.id)! + 1}` : "+ Ruta"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "ruta" && (
        <RoutePanel
          route={route} routeDate={routeDate} today={props.today} byId={byId}
          saveState={saveState} savedAt={savedAt}
          onDate={loadRouteFor}
          onChange={updateRoute}
          onShowOnMap={(id) => { setTab("mapa"); selectPoint(id, true); }}
        />
      )}

      {tab === "revisar" && (
        <ReviewPanel
          items={toReview}
          onPick={(id) => { setPickFor(id); setPicked(null); setTab("mapa"); }}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function alertMsg(m: string) {
  // Mensaje simple sin diálogos bloqueantes
  const el = document.createElement("div");
  el.textContent = m;
  el.className = "fixed bottom-24 left-4 right-4 z-[1000] rounded-lg bg-red-600 text-white text-sm p-3 shadow-lg";
  el.setAttribute("role", "alert");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function Legend() {
  return (
    <details className="mt-2 card p-2.5 text-xs" open>
      <summary className="font-semibold cursor-pointer">Leyenda</summary>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
        {MAP_GROUPS.map((g) => (
          <li key={g.key} className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center rounded-full border-2 text-[9px] text-white ${g.reference ? "w-5 h-5 border-yellow-400" : "w-4 h-4 border-white shadow"}`} style={{ background: g.color }}>{g.reference ? "★" : ""}</span>
            {g.label}
          </li>
        ))}
        {Object.entries(STREET_STATUS).map(([k, s]) => (
          <li key={k} className="flex items-center gap-2">
            <svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" stroke={s.color} strokeWidth="4" strokeDasharray={s.dash ? "4 3" : undefined} /></svg>
            {s.label}
          </li>
        ))}
        <li className="flex items-center gap-2 col-span-2">
          <span className="inline-flex w-5 h-5 rounded-full bg-gray-700 text-white text-[10px] font-bold items-center justify-center">3</span>
          Número = orden en tu ruta del día · Círculos con número = varios puntos juntos
        </li>
      </ul>
      <p className="text-gray-500 mt-2">★ Contrato firmado, en proceso o terminado: posibles referencias. Solo se pueden mencionar a vecinos si el cliente lo autorizó.</p>
    </details>
  );
}

function PointCard({ p, inRoute, onToggleRoute, onClose }: { p: MapPoint; inRoute: boolean; onToggleRoute: () => void; onClose: () => void }) {
  const g = groupInfo(p.group);
  const [refs, setRefs] = useState<NearbyRef[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { setRefs(null); setErr(null); }, [p.id]);
  return (
    <section className="card p-3 space-y-2 border-2" style={{ borderColor: g.color }} aria-live="polite">
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold">{p.customer}</div>
          <div className="text-sm text-gray-600">{p.address}</div>
        </div>
        <button type="button" className="text-gray-400 text-lg px-1" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="chip text-white border-transparent" style={{ background: g.color }}>{g.label}</span>
        <span className="chip bg-gray-100 border-gray-200">{p.statusLabel}</span>
        {p.referenceAuthorized && <span className="chip bg-yellow-100 text-yellow-800 border-yellow-300">Referencia autorizada</span>}
      </div>
      <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-gray-500">Vendedor</dt><dd>{p.repName ?? "Sin asignar"}</dd>
        <dt className="text-gray-500">Próxima</dt><dd>{p.nextActivity ? `${p.nextActivity.label}${p.nextActivity.when ? ` · ${fmtDateTime(p.nextActivity.when)}` : ""}` : "Sin actividad programada"}</dd>
        <dt className="text-gray-500">Última visita</dt><dd>{p.lastVisit ? fmtDateTime(p.lastVisit) : "Sin visitas registradas"}</dd>
        {p.locSource === "manual" && <><dt className="text-gray-500">Ubicación</dt><dd>Marcada a mano</dd></>}
      </dl>
      <div className="grid grid-cols-2 gap-2">
        <Link href={`/trabajos/${p.id}`} className="btn-primary min-h-[40px]">Abrir expediente</Link>
        <button type="button" className={`btn min-h-[40px] border ${inRoute ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`} onClick={onToggleRoute}>
          {inRoute ? "Quitar de la ruta" : "Agregar a la ruta"}
        </button>
      </div>
      {!g.reference && (
        <div className="border-t pt-2">
          {refs === null ? (
            <button type="button" className="text-sm font-semibold text-brand" disabled={pending}
              onClick={() => start(async () => { const r = await getNearby(p.id); if (r.ok) setRefs(r.refs); else setErr(r.error); })}>
              {pending ? "Buscando…" : "Ver trabajos firmados o terminados cercanos (1 mi)"}
            </button>
          ) : (
            <NearbyList refs={refs} compact />
          )}
          {err && <p className="text-sm text-red-700">{err}</p>}
        </div>
      )}
    </section>
  );
}

export function NearbyList({ refs, compact }: { refs: NearbyRef[]; compact?: boolean }) {
  if (!refs.length) {
    return <p className="text-sm text-gray-600">No hay trabajos firmados, en proceso ni terminados a menos de 1 milla. No menciones vecinos en esta visita.</p>;
  }
  const authorized = refs.filter((r) => r.authorized);
  const best = authorized[0];
  const verb = (s: string) => {
    const k = MAP_GROUPS.find((g) => g.statuses.includes(s))?.key;
    return k === "terminado" ? "terminamos el techo de" : k === "proceso" ? "estamos trabajando en el techo de" : "tenemos un contrato firmado con";
  };
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {refs.slice(0, compact ? 5 : 25).map((r, i) => (
          <li key={i} className="text-sm flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 chip ${r.authorized ? "bg-yellow-100 text-yellow-800 border-yellow-300" : "bg-gray-100 border-gray-200 text-gray-600"}`}>
              {r.authorized ? "Referencia autorizada" : "Sin autorización"}
            </span>
            <span className="min-w-0">
              <b>{fmtDistance(r.distance_m)}</b> · {statusInfo(r.status).label}
              {r.authorized ? <> · {r.customer_name} · {r.address}</> : r.street ? <> · {r.street}</> : null}
              {r.can_open && r.job_id && <> · <Link className="text-brand font-semibold" href={`/trabajos/${r.job_id}`}>abrir</Link></>}
            </span>
          </li>
        ))}
      </ul>
      {best ? (
        <p className="text-sm rounded-lg bg-yellow-50 border border-yellow-200 p-2">
          <b>Puedes decir:</b> “A {fmtDistance(best.distance_m)} de aquí, en {best.street ?? "esta zona"}, {verb(best.status)} un vecino que nos autorizó a mencionarlo.”
        </p>
      ) : (
        <p className="text-xs text-gray-600 rounded-lg bg-gray-50 p-2">
          Hay trabajos cercanos, pero ninguno con autorización de referencia. Úsalos solo para planear: no compartas nombres, direcciones ni detalles con el prospecto.
        </p>
      )}
    </div>
  );
}

function StreetCard({ s, me, onClose, onSaved }: { s: MapStreet; me: string; onClose: () => void; onSaved: () => void }) {
  const [visits, setVisits] = useState<Awaited<ReturnType<typeof getStreetVisits>> | null>(null);
  const [form, setForm] = useState({ date: "", segment: "", doors: "", notes: "", markStatus: "" as "" | "en_progreso" | "terminada" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const load = useCallback(() => getStreetVisits(s.id).then(setVisits), [s.id]);
  useEffect(() => { setVisits(null); setMsg(null); load(); }, [load]);
  const key = s.status === "pendiente" && s.visits > 0 ? "en_progreso" : s.status;
  void me;
  return (
    <section className="card p-3 space-y-2">
      <div className="flex justify-between gap-2">
        <div>
          <div className="font-bold">{s.name}</div>
          <div className="text-xs text-gray-500">Zona {s.territoryCode} · {s.doors} puertas · {s.leads} leads</div>
        </div>
        <button type="button" className="text-gray-400 text-lg px-1" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      <span className="chip" style={{ background: STREET_STATUS[key]?.color, color: "#fff", borderColor: "transparent" }}>{STREET_STATUS[key]?.label}</span>
      <p className="text-xs text-gray-500">Última visita: {s.lastVisit ? fmtDate(s.lastVisit) : "nunca"}{s.lastVisitBy ? ` · ${s.lastVisitBy}` : ""}</p>

      <form className="space-y-2 border-t pt-2" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addStreetVisit({ streetId: s.id, date: form.date || undefined, segment: form.segment, doors: form.doors ? Number(form.doors) : null, notes: form.notes, markStatus: form.markStatus });
          if (!r.ok) setMsg({ ok: false, text: r.error });
          else { setMsg({ ok: true, text: "Visita guardada." }); setForm({ date: "", segment: "", doors: "", notes: "", markStatus: "" }); load(); onSaved(); }
        });
      }}>
        <h3 className="font-semibold text-sm">Registrar visita a la calle o a un tramo</h3>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label="Fecha (hoy si se deja vacío)" />
          <input className="input" inputMode="numeric" placeholder="Puertas" value={form.doors} onChange={(e) => setForm({ ...form, doors: e.target.value.replace(/\D/g, "") })} aria-label="Puertas tocadas" />
        </div>
        <input className="input" placeholder="Tramo: #1200–1300, lado norte…" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} aria-label="Tramo" />
        <textarea className="input py-2" rows={2} placeholder="Notas: quién abrió, volver el sábado…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} aria-label="Notas" />
        <select className="input" value={form.markStatus} onChange={(e) => setForm({ ...form, markStatus: e.target.value as any })} aria-label="Estado de la calle">
          <option value="">No cambiar el estado de la calle</option>
          <option value="en_progreso">Marcar calle en progreso</option>
          <option value="terminada">Marcar TODA la calle como terminada</option>
        </select>
        <button className="btn-primary w-full min-h-[40px]" disabled={pending}>{pending ? "Guardando…" : "Guardar visita"}</button>
        {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</p>}
        <p className="text-xs text-gray-500">Registrar un tramo no marca la calle completa como terminada.</p>
      </form>

      <div className="border-t pt-2">
        <h3 className="font-semibold text-sm mb-1">Historial</h3>
        {!visits ? <p className="muted">Cargando…</p> : !visits.ok ? <p className="text-sm text-red-700">{visits.error}</p> : visits.visits.length === 0 ? (
          <p className="muted">Sin visitas registradas.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {visits.visits.map((v) => (
              <li key={v.id} className="flex justify-between gap-2">
                <span className="min-w-0">
                  <b>{fmtDate(v.visited_on)}</b> · {v.who ?? "—"}{v.segment ? ` · ${v.segment}` : ""}{v.doors != null ? ` · ${v.doors} puertas` : ""}
                  {v.notes && <span className="block text-gray-600">{v.notes}</span>}
                </span>
                {v.mine && (
                  <button type="button" className="text-xs text-gray-400 hover:text-red-600 shrink-0"
                    onClick={() => start(async () => { const r = await deleteStreetVisit(v.id); if (r.ok) { load(); onSaved(); } else setMsg({ ok: false, text: r.error }); })}>
                    Borrar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RoutePanel({ route, routeDate, today, byId, saveState, savedAt, onDate, onChange, onShowOnMap }: {
  route: Route; routeDate: string; today: string; byId: Map<string, MapPoint>;
  saveState: string; savedAt: string | null;
  onDate: (d: string) => void; onChange: (fn: (r: Route) => Route) => void; onShowOnMap: (id: string) => void;
}) {
  const [addr, setAddr] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stops = route.stops.map((id) => byId.get(id)).filter(Boolean) as MapPoint[];
  const missing = route.stops.length - stops.length;
  const withLoc = stops.filter((p) => p.lat != null);
  const start: LatLng | null = route.start_lat != null && route.start_lng != null ? { lat: route.start_lat, lng: route.start_lng } : null;

  const move = (i: number, d: number) => onChange((r) => {
    const s = [...r.stops]; const j = i + d;
    if (j < 0 || j >= s.length) return r;
    [s[i], s[j]] = [s[j], s[i]];
    return { ...r, stops: s, order_mode: "manual" };
  });

  function sortByDistance() {
    // Vecino más cercano en línea recta. NO es una ruta optimizada por calles.
    const pts = withLoc.map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng! }));
    if (pts.length < 2) return;
    let cur: LatLng = start ?? pts[0];
    const order: string[] = [];
    const left = [...pts];
    if (!start) { order.push(left.shift()!.id); }
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((p, i) => { const d = distanceM(cur, p); if (d < bd) { bd = d; bi = i; } });
      const [n] = left.splice(bi, 1);
      order.push(n.id); cur = n;
    }
    const noLoc = route.stops.filter((id) => !order.includes(id));
    onChange((r) => ({ ...r, stops: [...order, ...noLoc], order_mode: "cercania" }));
  }

  function useGps() {
    setMsg(null);
    if (!("geolocation" in navigator)) { setMsg("Este teléfono no permite obtener la ubicación. Escribe una dirección de salida."); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange((r) => ({ ...r, start_mode: "gps", start_label: "Mi ubicación actual", start_lat: pos.coords.latitude, start_lng: pos.coords.longitude }));
      },
      (err) => {
        setBusy(false);
        setMsg(err.code === 1 ? "No diste permiso para usar tu ubicación. Puedes escribir una dirección de salida." : "No se pudo obtener tu ubicación. Escribe una dirección de salida.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  async function useAddress() {
    setMsg(null); setBusy(true);
    const r = await geocodeStart(addr);
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    onChange((x) => ({ ...x, start_mode: "manual", start_label: r.label, start_lat: r.lat, start_lng: r.lng }));
    setAddr("");
  }

  const chunks = chunkStops(withLoc.map((p) => ({ lat: p.lat!, lng: p.lng! })));

  return (
    <div className="px-4 lg:px-0 mt-3 space-y-3">
      <section className="card p-3 space-y-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="r-date">Fecha de la ruta</label>
            <input id="r-date" type="date" className="input" value={routeDate} onChange={(e) => e.target.value && onDate(e.target.value)} />
          </div>
          {routeDate !== today && <button type="button" className="btn-secondary min-h-[44px] px-3" onClick={() => onDate(today)}>Hoy</button>}
        </div>
        <p className="text-xs text-gray-500" role="status">
          {saveState === "guardando" ? "Guardando…" : saveState === "error" ? "No se pudo guardar. Revisa tu conexión; se reintentará con el próximo cambio." : savedAt ? `Guardada · ${fmtDateTime(savedAt)}` : "Se guarda sola en tu cuenta para esta fecha."}
        </p>
      </section>

      <section className="card p-3 space-y-2">
        <h2 className="font-bold">Salida</h2>
        {start ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{route.start_mode === "gps" ? "📍 " : "🏁 "}{route.start_label}</span>
            <button type="button" className="text-xs text-gray-500 underline" onClick={() => onChange((r) => ({ ...r, start_mode: "ninguno", start_label: null, start_lat: null, start_lng: null }))}>Quitar</button>
          </div>
        ) : <p className="text-sm text-gray-500">Sin punto de salida. Google Maps usará tu ubicación al abrir la ruta.</p>}
        <button type="button" className="btn-secondary w-full min-h-[44px]" onClick={useGps} disabled={busy}>Usar mi ubicación actual</button>
        <div className="flex gap-2">
          <input className="input" placeholder="O escribe una dirección de salida" value={addr} onChange={(e) => setAddr(e.target.value)} aria-label="Dirección de salida" />
          <button type="button" className="btn-secondary shrink-0 px-3" onClick={useAddress} disabled={busy || addr.trim().length < 6}>Usar</button>
        </div>
        {msg && <p className="text-sm text-red-700">{msg}</p>}
      </section>

      <section className="card p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">Paradas ({route.stops.length})</h2>
          {withLoc.length > 1 && <button type="button" className="text-sm font-semibold text-brand" onClick={sortByDistance}>Ordenar por cercanía</button>}
        </div>
        <p className="text-xs text-gray-500">
          {route.order_mode === "cercania"
            ? "Orden aproximado por cercanía en línea recta desde la salida. No es una ruta optimizada por calles; puedes moverlas a mano."
            : "Orden manual. Usa las flechas para cambiarlo."}
        </p>
        {route.stops.length === 0 ? (
          <p className="muted">Agrega paradas desde el mapa con “+ Ruta”.</p>
        ) : (
          <ol className="divide-y divide-gray-100">
            {route.stops.map((id, i) => {
              const p = byId.get(id);
              return (
                <li key={id} className="py-2 flex items-center gap-2">
                  <span className="w-7 h-7 shrink-0 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    {p ? (
                      <>
                        <button type="button" className="font-semibold text-left truncate block w-full" onClick={() => onShowOnMap(id)}>{p.customer}</button>
                        <span className="block text-xs text-gray-500 truncate">{p.address || "Sin dirección"}</span>
                        <span className="block text-xs text-gray-500">{p.statusLabel}{p.lat == null ? " · ⚠ sin ubicación, no entra en la navegación" : ""}</span>
                        {p.lat != null && (
                          <a className="text-xs font-semibold text-brand" href={appleDirUrl(null, { lat: p.lat, lng: p.lng! })} target="_blank" rel="noopener">Apple Maps</a>
                        )}
                      </>
                    ) : <span className="text-sm text-gray-500">Registro no disponible (sin acceso o eliminado)</span>}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button type="button" className="w-9 h-8 rounded border text-sm disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                    <button type="button" className="w-9 h-8 rounded border text-sm disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === route.stops.length - 1} aria-label="Bajar">▼</button>
                  </div>
                  <button type="button" className="text-gray-400 px-1" onClick={() => onChange((r) => ({ ...r, stops: r.stops.filter((x) => x !== id) }))} aria-label="Quitar parada">✕</button>
                </li>
              );
            })}
          </ol>
        )}
        {missing > 0 && <p className="text-xs text-amber-700">{missing} parada(s) ya no están disponibles.</p>}
      </section>

      {withLoc.length > 0 && (
        <section className="card p-3 space-y-2">
          <h2 className="font-bold">Abrir navegación</h2>
          {chunks.map((c, i) => {
            const origin = i === 0 ? start : chunks[i - 1][chunks[i - 1].length - 1];
            return (
              <a key={i} className="btn-primary w-full min-h-[44px]" href={googleDirUrl(origin, c) ?? "#"} target="_blank" rel="noopener">
                Google Maps{chunks.length > 1 ? ` · paradas ${i * 10 + 1}–${i * 10 + c.length}` : ""}
              </a>
            );
          })}
          <a className="btn-secondary w-full min-h-[44px]" href={appleDirUrl(start, { lat: withLoc[0].lat!, lng: withLoc[0].lng! })} target="_blank" rel="noopener">
            Apple Maps · primera parada
          </a>
          <p className="text-xs text-gray-500">Apple Maps abre una parada a la vez; usa el enlace de cada parada para seguir. Google Maps abre hasta 10 paradas por enlace.</p>
        </section>
      )}
    </div>
  );
}

function ReviewPanel({ items, onPick, onChanged }: { items: MapPoint[]; onPick: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const reason = (p: MapPoint) => ({
    sin_direccion: "Falta la dirección completa (número, calle y ciudad o ZIP).",
    pendiente: "Todavía no se ha ubicado. Se está procesando.",
    sin_resultado: "El servicio no encontró esta dirección. Revisa el número y la calle.",
    ambigua: "La dirección coincide con varios lugares. Elige el correcto.",
    error: `El servicio de ubicación falló${p.locError ? `: ${p.locError}` : ""}. Puedes reintentar.`,
    ok: "",
  }[p.locStatus]);
  if (!items.length) return <div className="px-4 lg:px-0 mt-3"><div className="card p-6 text-center muted">Todas las direcciones tienen ubicación.</div></div>;
  return (
    <div className="px-4 lg:px-0 mt-3 space-y-2">
      <p className="text-sm text-gray-600">Estos registros no aparecen en el mapa porque no tienen una ubicación válida.</p>
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id} className="card p-3 space-y-2">
            <div>
              <div className="font-semibold">{p.customer}</div>
              <div className="text-sm text-gray-600">{p.address || "Sin dirección"}</div>
              <div className="text-xs text-gray-500">{p.statusLabel}{p.repName ? ` · ${p.repName}` : ""}</div>
            </div>
            <p className={`text-sm ${p.locStatus === "pendiente" ? "text-blue-700" : "text-amber-800"}`}>{reason(p)}</p>
            {p.locStatus === "ambigua" && p.candidates.length > 0 && (
              <div className="space-y-1">
                {p.candidates.map((c, i) => (
                  <button key={i} type="button" disabled={busy === p.id} className="btn-secondary w-full min-h-[40px] justify-start text-left text-xs"
                    onClick={async () => { setBusy(p.id); const r = await chooseCandidate(p.id, i); setBusy(null); if (r.ok) onChanged(); else setMsgs((m) => ({ ...m, [p.id]: r.error })); }}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href={`/trabajos/${p.id}`} className="btn-secondary min-h-[36px] px-3">Corregir dirección</Link>
              {(p.locStatus === "error" || p.locStatus === "sin_resultado" || p.locStatus === "ambigua") && (
                <button type="button" className="btn-secondary min-h-[36px] px-3" disabled={busy === p.id}
                  onClick={async () => {
                    setBusy(p.id);
                    const r = await retryGeocode(p.id);
                    setBusy(null);
                    if (!r.ok) setMsgs((m) => ({ ...m, [p.id]: r.error }));
                    else { setMsgs((m) => ({ ...m, [p.id]: r.status === "ok" ? "Ubicada." : "Sigue sin una ubicación clara." })); onChanged(); }
                  }}>{busy === p.id ? "Buscando…" : "Reintentar"}</button>
              )}
              {p.locStatus !== "pendiente" && (
                <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => onPick(p.id)}>Marcar en el mapa</button>
              )}
            </div>
            {msgs[p.id] && <p className="text-sm text-gray-700">{msgs[p.id]}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
