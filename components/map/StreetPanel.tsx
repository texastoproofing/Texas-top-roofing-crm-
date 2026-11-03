"use client";
// Street Intelligence: panel lateral (desktop) / hoja inferior (móvil) al seleccionar una calle.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { StatusPill } from "@/components/HouseStatus";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { statusInfo } from "@/lib/constants";
import {
  HOUSE_STATUS, HOUSE_STATUS_KEYS, ORDER_NOTE, PRIORITY_LABEL, PRIORITY_WINDOW_DAYS, STORM_RADIUS_MI,
  canvassOrder, houseCounts, nextHouse, type HouseStatus, type StormCard,
} from "@/lib/street-intel";
import {
  addHouseNote, assignHouses, createLeadFromHouse, finishCanvass, getHouseHistory, getStreetIntel, linkHouseToJob,
  scheduleHouseInspection, setHouseStatus, startCanvass,
  type IntelEvent, type IntelHouse, type StreetIntel,
} from "@/app/(app)/mapa/street-actions";

export type MapFocus = { lat: number; lng: number } | { bbox: number[] };
type Tab = "casas" | "recorrido" | "tormentas" | "historial" | "calle";
type Toast = { ok: boolean; text: string } | null;

const VISIT_RESULTS: HouseStatus[] = ["no_answer", "visited", "interested", "do_not_contact"];
const SKIP_REASONS = ["Perro / no es seguro", "Portón cerrado", "Nadie en casa (volver luego)", "Casa en venta / vacía", "Otro"];
const EVENT_LABEL: Record<string, string> = { status: "Cambio de estado", visit: "Visita", note: "Nota", assign: "Asignación", skip: "Saltada", lead: "Lead enlazado", appointment: "Inspección agendada" };
const nav = (addr: string) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`,
  apple: `https://maps.apple.com/?daddr=${encodeURIComponent(addr)}`,
});

export function StreetPanel({ streetId, users, onClose, onFocus, onChanged, streetVisitForm }: {
  streetId: string; users: { id: string; name: string }[];
  onClose: () => void; onFocus: (f: MapFocus) => void; onChanged: () => void; streetVisitForm: ReactNode;
}) {
  const [intel, setIntel] = useState<StreetIntel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("casas");
  const [toast, setToast] = useState<Toast>(null);
  const busy = useRef(0);

  // ---- Tamaño y estado del panel ----
  const [isDesk, setIsDesk] = useState(false);
  const [width, setWidth] = useState(440);
  const [minimized, setMinimized] = useState(false);
  const [snap, setSnap] = useState<"min" | "mid" | "full">("mid");
  const [dragH, setDragH] = useState<number | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const f = () => setIsDesk(mq.matches);
    f(); mq.addEventListener("change", f);
    try { const w = Number(localStorage.getItem("si-width")); if (w >= 360 && w <= 760) setWidth(w); } catch {}
    return () => mq.removeEventListener("change", f);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) { setIntel(null); setError(null); }
    const r = await getStreetIntel(streetId).catch(() => null);
    if (!r) { if (!quiet) setError("Sin conexión. Revisa la señal e intenta de nuevo."); return; }
    if (!r.ok) { if (!quiet) setError(r.error); return; }
    if (quiet && busy.current > 0) return; // no pisar un cambio optimista en curso
    setIntel(r.intel);
  }, [streetId]);
  useEffect(() => { setTab("casas"); setMinimized(false); setSnap("mid"); load(); }, [load]);
  // Datos al día entre vendedores: recarga al volver a la pestaña y cada 45 s si está visible
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") load(true); };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 45000);
    return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
  }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest("input,textarea,select")) onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Cambio optimista de una casa con reversión si falla
  const patchHouse = (id: string, patch: Partial<IntelHouse>) =>
    setIntel((cur) => cur && { ...cur, houses: cur.houses.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
  const changeStatus = async (h: IntelHouse, status: HouseStatus, kind: "status" | "visit" | "skip", note?: string) => {
    if (h.status === "do_not_contact" && status !== "do_not_contact" && !intel?.staff) {
      setToast({ ok: false, text: "Solo la oficina puede quitar \"No contactar\"." }); return false;
    }
    const prev = { status: h.status, statusAt: h.statusAt, statusBy: h.statusBy };
    busy.current++;
    patchHouse(h.id, { status, statusAt: new Date().toISOString(), statusBy: "Tú" });
    const r = await setHouseStatus({ houseId: h.id, status, kind, note, sessionId: intel?.mySession?.id ?? null, expected: h.statusAt }).catch(() => null);
    busy.current--;
    if (!r || !r.ok) {
      patchHouse(h.id, prev);
      setToast({ ok: false, text: r && !r.ok ? r.error : "Sin conexión: no se guardó. Intenta de nuevo." });
      if (r && !r.ok && r.conflict) load(true);
      return false;
    }
    patchHouse(h.id, { statusAt: r.statusAt });
    setToast({ ok: true, text: kind === "skip" ? "Casa saltada." : `Guardado: ${HOUSE_STATUS[status].label}.` });
    load(true);
    if (kind === "visit") onChanged();
    return true;
  };

  const counts = useMemo(() => houseCounts(intel?.houses ?? []), [intel]);
  const s = intel?.street;
  const addrOf = (h: IntelHouse) => [h.situs, s?.city, "TX", s?.zip].filter(Boolean).join(", ");

  // ---- Contenido ----
  const header = (
    <div className="flex items-start gap-2 px-4 pt-3 pb-2">
      <div className="min-w-0 flex-1">
        {s ? (
          <>
            <h2 className="font-bold text-lg leading-tight truncate" id="si-title">{s.name}</h2>
            <p className="text-xs text-muted truncate">{[s.city, s.zip].filter(Boolean).join(" · ") || "Ciudad sin dato"} · Zona {s.territoryCode}</p>
          </>
        ) : <><div className="skel h-5 w-40" /><div className="skel h-3 w-28 mt-1.5" /></>}
      </div>
      {isDesk && (
        <button type="button" className="p-2 rounded-lg hover:bg-canvas text-muted" onClick={() => setMinimized(true)} aria-label="Minimizar panel">
          <Icon name="minimize" className="w-4 h-4" />
        </button>
      )}
      <button type="button" className="p-2 rounded-lg hover:bg-canvas text-muted" onClick={onClose} aria-label="Cerrar panel"><Icon name="x" className="w-4 h-4" /></button>
    </div>
  );

  const body = error ? (
    <div className="p-4 space-y-3">
      <p className="text-sm text-red-700" role="alert">{error}</p>
      <button type="button" className="btn-secondary btn-sm" onClick={() => load()}><Icon name="refresh" className="w-4 h-4" />Reintentar</button>
    </div>
  ) : !intel ? (
    <div className="p-4 space-y-3" aria-busy="true" aria-label="Cargando calle">
      <div className="grid grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skel h-14" />)}</div>
      <div className="skel h-2.5 w-full" />
      {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel h-12" />)}
    </div>
  ) : (
    <>
      <Summary intel={intel} counts={counts} />
      <div className="px-4 sticky top-0 z-10 bg-white pt-1 pb-2 border-b border-line">
        <div className="seg w-full overflow-x-auto" role="tablist" aria-label="Secciones de la calle">
          {([["casas", `Casas ${counts.total || ""}`], ["recorrido", "Recorrido"], ["tormentas", "Tormentas"], ["historial", "Historial"], ["calle", "Tramos"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="flex-1 whitespace-nowrap">{l}</button>
          ))}
        </div>
      </div>
      <div className="p-4">
        {tab === "casas" && <HousesTab intel={intel} users={users} addrOf={addrOf} onStatus={changeStatus} onReload={() => load(true)} onToast={setToast} onChanged={onChanged} />}
        {tab === "recorrido" && <CanvassTab intel={intel} counts={counts} addrOf={addrOf} onStatus={changeStatus} onReload={() => load(true)} onToast={setToast} onChanged={onChanged} />}
        {tab === "tormentas" && <StormTab intel={intel} onFocus={(f) => { onFocus(f); if (!isDesk) setSnap("min"); }} />}
        {tab === "historial" && <HistoryTab events={intel.events} houses={intel.houses} />}
        {tab === "calle" && <div className="space-y-2">{streetVisitForm}</div>}
      </div>
    </>
  );

  const toastEl = toast && (
    <div role="status" aria-live="polite" className={`absolute left-4 right-4 bottom-3 z-20 rounded-xl px-3 py-2 text-sm font-medium shadow-pop ${toast.ok ? "bg-night text-white" : "bg-red-600 text-white"}`}>{toast.text}</div>
  );

  // ---- Desktop: panel derecho redimensionable ----
  if (isDesk) {
    if (minimized) {
      return (
        <button type="button" onClick={() => setMinimized(false)}
          className="fixed right-4 bottom-6 z-[1100] card shadow-pop px-4 py-3 flex items-center gap-2 font-semibold animate-[fade_.15s]">
          <Icon name="streets" className="w-4 h-4 text-brand" />{s?.name ?? "Calle"}
          {intel && <span className="text-xs text-muted tnum">{counts.pct}%</span>}
          <Icon name="maximize" className="w-4 h-4 text-muted" />
        </button>
      );
    }
    const startResize = (e: { clientX: number; preventDefault: () => void }) => {
      e.preventDefault();
      const x0 = e.clientX, w0 = width;
      const move = (ev: PointerEvent) => setWidth(Math.max(360, Math.min(760, w0 + (x0 - ev.clientX))));
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); try { localStorage.setItem("si-width", String(document.getElementById("si-panel")?.offsetWidth ?? 440)); } catch {} };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };
    return (
      <aside id="si-panel" role="dialog" aria-modal="false" aria-labelledby="si-title"
        className="fixed right-0 top-16 bottom-0 z-[1100] bg-white border-l border-line shadow-pop flex flex-col animate-[panel-in_.2s_ease-out]"
        style={{ width }}>
        <div onPointerDown={startResize} className="absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize group" role="separator" aria-orientation="vertical" aria-label="Cambiar ancho del panel">
          <div className="mx-auto h-full w-0.5 group-hover:bg-brand/50" />
        </div>
        {header}
        <div className="flex-1 overflow-y-auto overscroll-contain">{body}</div>
        {toastEl}
      </aside>
    );
  }

  // ---- Móvil: hoja inferior con 3 posiciones ----
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const H = { min: 132, mid: Math.round(vh * 0.55), full: Math.round(vh * 0.9) };
  const h = dragH ?? H[snap];
  const onDragStart = (e: { clientY: number; pointerId: number; target: EventTarget }) => {
    const y0 = e.clientY, h0 = h;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    let last = h0;
    const move = (ev: PointerEvent) => { last = Math.max(96, Math.min(H.full, h0 + (y0 - ev.clientY))); setDragH(last); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const near = (Object.entries(H) as [typeof snap, number][]).sort((a, b) => Math.abs(a[1] - last) - Math.abs(b[1] - last))[0][0];
      setSnap(near); setDragH(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const cycle = () => setSnap(snap === "min" ? "mid" : snap === "mid" ? "full" : "min");
  return (
    <section role="dialog" aria-modal="false" aria-labelledby="si-title"
      className={`fixed inset-x-0 z-[1001] bg-white rounded-t-2xl shadow-[0_-8px_30px_rgba(0,0,0,.18)] flex flex-col animate-[sheet_.2s_ease-out] ${dragH == null ? "transition-[height] duration-200" : ""}`}
      style={{ bottom: "calc(59px + env(safe-area-inset-bottom))", height: h }}>
      <button type="button" onPointerDown={onDragStart} onClick={cycle}
        className="w-full pt-2 pb-1 touch-none cursor-grab" aria-label={`Panel ${snap === "min" ? "minimizado" : snap === "mid" ? "a la mitad" : "expandido"}. Toca para cambiar`}>
        <span className="block mx-auto h-1.5 w-11 rounded-full bg-gray-300" />
      </button>
      {header}
      {snap === "min" && intel && (
        <div className="px-4 pb-2 flex items-center gap-2 text-xs text-muted">
          <span className="tnum font-semibold text-ink">{counts.worked}/{counts.total}</span> trabajadas
          <div className="flex-1 h-1.5 rounded-full bg-canvas overflow-hidden"><div className="h-full bg-brand" style={{ width: `${counts.pct}%` }} /></div>
          <span className="tnum">{counts.pct}%</span>
        </div>
      )}
      <div className={`flex-1 overflow-y-auto overscroll-contain ${snap === "min" ? "hidden" : ""}`}>{body}</div>
      {toastEl}
    </section>
  );
}

// =====================================================================
function Summary({ intel, counts }: { intel: StreetIntel; counts: ReturnType<typeof houseCounts> }) {
  const p = intel.priority;
  const tone = p.level === "alta" ? "bg-red-50 text-red-700" : p.level === "media" ? "bg-amber-50 text-amber-800" : "bg-canvas text-muted";
  const stat = (label: string, value: ReactNode, sub?: string) => (
    <div className="rounded-xl bg-canvas px-2.5 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="font-bold tnum leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted truncate">{sub}</div>}
    </div>
  );
  return (
    <div className="px-4 pb-3 space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        <span className={`chip border-0 ${tone}`} title="Ver criterios en la pestaña Tormentas"><Icon name="storm" className="w-3.5 h-3.5" />{PRIORITY_LABEL[p.level as keyof typeof PRIORITY_LABEL]}{p.level !== "sin_datos" && ` · ${p.score}/${p.max}`}</span>
        {intel.sessions.filter((x) => !intel.mySession || x.id !== intel.mySession.id).map((x) => (
          <span key={x.id} className="chip border-0 bg-blue-50 text-blue-700"><Icon name="route" className="w-3.5 h-3.5" />{x.userName ?? "Otro vendedor"} recorriendo</span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {stat("Propiedades", counts.total, counts.total ? "registro del condado" : "sin cargar")}
        {stat("Visitadas", counts.worked)}
        {stat("Pendientes", counts.pending)}
        {stat("Leads", intel.street.leads)}
        {stat("Inspecciones", intel.inspections.scheduled, intel.inspections.next ? fmtDateTime(intel.inspections.next) : "próximas")}
        {stat("Asignado", <span className="text-sm">{intel.assigned.length ? intel.assigned.join(", ") : "—"}</span>)}
      </div>
      <div>
        <div className="flex justify-between text-xs mb-1"><span className="text-muted">Avance</span><span className="font-semibold tnum">{counts.pct}%</span></div>
        <div className="h-2 rounded-full bg-canvas overflow-hidden" role="progressbar" aria-valuenow={counts.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avance de la calle">
          <div className="h-full bg-brand transition-[width]" style={{ width: `${counts.pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// =====================================================================
function HousesTab({ intel, users, addrOf, onStatus, onReload, onToast, onChanged }: {
  intel: StreetIntel; users: { id: string; name: string }[]; addrOf: (h: IntelHouse) => string;
  onStatus: (h: IntelHouse, s: HouseStatus, k: "status" | "visit" | "skip", note?: string) => Promise<boolean>;
  onReload: () => void; onToast: (t: Toast) => void; onChanged: () => void;
}) {
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [filter, setFilter] = useState<HouseStatus | "todas">("todas");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim().toLowerCase()), 200); return () => clearTimeout(t); }, [q]);
  const counts = houseCounts(intel.houses);
  const list = intel.houses.filter((h) => (filter === "todas" || h.status === filter) && (!dq || `${h.situs} ${h.owner ?? ""}`.toLowerCase().includes(dq)));

  if (!intel.houses.length) {
    return (
      <div className="text-center py-6 space-y-2">
        <Icon name="door" className="w-8 h-8 mx-auto text-muted" />
        <p className="font-semibold">No hay casas cargadas para esta calle</p>
        <p className="text-sm text-muted">Las casas vienen del registro del condado. {intel.staff ? "Cárgalas desde la página del territorio con \"Cargar dueños\"." : "Pide a la oficina que las cargue."}</p>
        <Link className="btn-secondary btn-sm" href={`/territorios/${intel.street.territoryId}`}>Ir al territorio</Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <label className="relative block">
        <span className="sr-only">Buscar dirección o dueño</span>
        <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Buscar número, dirección o dueño" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" />
      </label>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Filtrar por estado">
        <button type="button" aria-pressed={filter === "todas"} onClick={() => setFilter("todas")} className={`chip shrink-0 ${filter === "todas" ? "bg-night text-white border-night" : "bg-white"}`}>Todas {counts.total}</button>
        {HOUSE_STATUS_KEYS.filter((k) => counts.by[k] > 0 || k === "not_visited").map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(filter === k ? "todas" : k)}
            className="chip shrink-0" style={filter === k ? { background: HOUSE_STATUS[k].color, color: "#fff", borderColor: HOUSE_STATUS[k].color } : { background: "#fff" }}>
            <Icon name={HOUSE_STATUS[k].icon} className="w-3 h-3" strokeWidth={2.25} />{HOUSE_STATUS[k].label} {counts.by[k]}
          </button>
        ))}
      </div>
      {list.length === 0 ? <p className="text-sm text-muted py-4 text-center">Ninguna casa coincide con la búsqueda o el filtro.</p> : (
        <ul className="space-y-1.5">
          {list.slice(0, limit).map((h) => (
            <li key={h.id} className={`rounded-xl border ${open === h.id ? "border-ink/20 shadow-card" : "border-line"} ${h.status === "do_not_contact" ? "bg-red-50/40" : "bg-white"}`}>
              <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-left min-h-[52px]" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-sm truncate">{h.situs}</span>
                  <span className="block text-[11px] text-muted truncate">
                    {h.owner ? `${h.owner}${h.ownerOccupied ? " · vive ahí" : ""}` : "Dueño sin dato"}
                    {h.job && ` · Lead #${h.job.number}`}
                    {h.assignedName && ` · ${h.assignedName}`}
                  </span>
                </span>
                <StatusPill s={h.status} small />
                <Icon name="chevronDown" className={`w-4 h-4 text-muted transition ${open === h.id ? "rotate-180" : ""}`} />
              </button>
              {open === h.id && <HouseActions h={h} intel={intel} users={users} addr={addrOf(h)} onStatus={onStatus} onReload={onReload} onToast={onToast} onChanged={onChanged} />}
            </li>
          ))}
        </ul>
      )}
      {list.length > limit && <button type="button" className="btn-secondary w-full" onClick={() => setLimit(limit + 60)}>Mostrar {Math.min(60, list.length - limit)} más</button>}
      <p className="text-[11px] text-muted">Casas y dueños según el registro público del condado. Confirma el nombre con la persona.</p>
    </div>
  );
}

function HouseActions({ h, intel, users, addr, onStatus, onReload, onToast, onChanged, compact }: {
  h: IntelHouse; intel: StreetIntel; users: { id: string; name: string }[]; addr: string; compact?: boolean;
  onStatus: (h: IntelHouse, s: HouseStatus, k: "status" | "visit" | "skip", note?: string) => Promise<boolean>;
  onReload: () => void; onToast: (t: Toast) => void; onChanged: () => void;
}) {
  const [mode, setMode] = useState<null | "lead" | "note" | "insp" | "assign" | "history" | "other">(null);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  const dnc = h.status === "do_not_contact";
  const run = async (fn: () => Promise<boolean | void>) => { if (saving) return; setSaving(true); try { await fn(); } finally { setSaving(false); } };
  const n = nav(addr);
  return (
    <div className={`${compact ? "" : "px-3 pb-3 border-t border-line pt-2.5"} space-y-2.5`}>
      {dnc && <p className="text-xs font-semibold text-red-700 flex items-center gap-1"><Icon name="ban" className="w-4 h-4" />No contactar: no tocar la puerta ni llamar.{!intel.staff && " Solo la oficina puede quitar esta marca."}</p>}
      {!dnc && (
        <div>
          <div className="text-[11px] font-semibold text-muted mb-1">Resultado de la visita (un toque)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {VISIT_RESULTS.map((k) => (
              <button key={k} type="button" disabled={saving}
                onClick={() => { if (k === "do_not_contact" && !armed) { setArmed(true); return; } setArmed(false); run(() => onStatus(h, k, "visit")); }}
                className="flex items-center gap-1.5 rounded-xl border px-2.5 min-h-[44px] text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: HOUSE_STATUS[k].color + "55", background: h.status === k || (k === "do_not_contact" && armed) ? HOUSE_STATUS[k].bg : "#fff", color: HOUSE_STATUS[k].color }}>
                <Icon name={HOUSE_STATUS[k].icon} className="w-4 h-4" strokeWidth={2.25} />{k === "do_not_contact" && armed ? "Toca otra vez para confirmar" : HOUSE_STATUS[k].label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {h.job ? (
          <Link href={`/trabajos/${h.job.id}`} className="btn-secondary btn-sm"><Icon name="jobs" className="w-4 h-4" />Lead #{h.job.number} · {statusInfo(h.job.status).label}</Link>
        ) : h.possibleJob ? (
          <button type="button" className="btn-secondary btn-sm" disabled={saving} onClick={() => run(async () => {
            const r = await linkHouseToJob(h.id, h.possibleJob!.id);
            onToast(r.ok ? { ok: true, text: `Enlazada con el trabajo #${h.possibleJob!.number}.` } : { ok: false, text: r.error }); if (r.ok) onReload();
          })}><Icon name="jobs" className="w-4 h-4" />Enlazar lead #{h.possibleJob.number}</button>
        ) : !dnc && (
          <button type="button" className="btn-primary btn-sm" onClick={() => setMode(mode === "lead" ? null : "lead")}><Icon name="plus" className="w-4 h-4" />Lead</button>
        )}
        {h.job && !dnc && <button type="button" className="btn-secondary btn-sm" onClick={() => setMode(mode === "insp" ? null : "insp")}><Icon name="calendar" className="w-4 h-4" />Inspección</button>}
        <button type="button" className="btn-secondary btn-sm" onClick={() => setMode(mode === "note" ? null : "note")}><Icon name="note" className="w-4 h-4" />Nota</button>
        {intel.staff && <button type="button" className="btn-secondary btn-sm" onClick={() => setMode(mode === "assign" ? null : "assign")}><Icon name="user" className="w-4 h-4" />Asignar</button>}
        <a className="btn-secondary btn-sm" href={n.google} target="_blank" rel="noopener noreferrer"><Icon name="navigation" className="w-4 h-4" />Google</a>
        <a className="btn-secondary btn-sm" href={n.apple} target="_blank" rel="noopener noreferrer">Apple Maps</a>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setMode(mode === "other" ? null : "other")}>Otro estado</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setMode(mode === "history" ? null : "history")}><Icon name="clock" className="w-4 h-4" />Historial</button>
      </div>
      {h.note && mode !== "note" && <p className="text-xs text-muted"><b>Última nota:</b> {h.note}</p>}
      {h.statusAt && <p className="text-[11px] text-muted">Estado cambiado {fmtDateTime(h.statusAt)}{h.statusBy ? ` por ${h.statusBy}` : ""}</p>}

      {mode === "other" && (
        <div className="grid grid-cols-2 gap-1.5">
          {HOUSE_STATUS_KEYS.filter((k) => !VISIT_RESULTS.includes(k) || (dnc && intel.staff)).map((k) => (
            <button key={k} type="button" disabled={saving || (dnc && !intel.staff)} onClick={() => run(async () => { if (await onStatus(h, k, "status")) setMode(null); })}
              className="flex items-center gap-1.5 rounded-xl border border-line px-2.5 min-h-[40px] text-sm disabled:opacity-50" style={{ color: HOUSE_STATUS[k].color }}>
              <Icon name={HOUSE_STATUS[k].icon} className="w-4 h-4" />{HOUSE_STATUS[k].label}
            </button>
          ))}
        </div>
      )}
      {mode === "lead" && <LeadForm h={h} onDone={(ok, text) => { onToast({ ok, text }); if (ok) { setMode(null); onReload(); onChanged(); } }} streetId={intel.street.id} />}
      {mode === "note" && (
        <form className="space-y-1.5" onSubmit={(e) => {
          e.preventDefault(); const fd = new FormData(e.currentTarget); const note = String(fd.get("note") ?? "");
          run(async () => { const r = await addHouseNote(h.id, note); onToast(r.ok ? { ok: true, text: "Nota guardada." } : { ok: false, text: r.error }); if (r.ok) { setMode(null); onReload(); } });
        }}>
          <textarea name="note" className="input py-2" rows={2} maxLength={1000} required autoFocus placeholder="Ej.: volver el sábado, habló la esposa…" aria-label="Nota" />
          <button className="btn-primary btn-sm w-full" disabled={saving}>{saving ? "Guardando…" : "Guardar nota"}</button>
        </form>
      )}
      {mode === "insp" && (
        <form className="space-y-1.5" onSubmit={(e) => {
          e.preventDefault(); const fd = new FormData(e.currentTarget);
          run(async () => {
            const r = await scheduleHouseInspection({ houseId: h.id, startsAt: String(fd.get("at") ?? ""), notes: String(fd.get("notes") ?? "") });
            onToast(r.ok ? { ok: true, text: "Inspección agendada en el calendario." } : { ok: false, text: r.error }); if (r.ok) { setMode(null); onReload(); onChanged(); }
          });
        }}>
          <label className="label" htmlFor={`at-${h.id}`}>Fecha y hora de la inspección</label>
          <input id={`at-${h.id}`} name="at" type="datetime-local" className="input" required />
          <input name="notes" className="input" placeholder="Nota para el inspector (opcional)" maxLength={1000} aria-label="Nota" />
          <button className="btn-primary btn-sm w-full" disabled={saving}>{saving ? "Agendando…" : "Agendar inspección"}</button>
          <p className="text-[11px] text-muted">Se crea en el calendario y el trabajo pasa a "Inspección agendada" solo si seguía como lead nuevo o contactado.</p>
        </form>
      )}
      {mode === "assign" && (
        <form className="flex gap-1.5" onSubmit={(e) => {
          e.preventDefault(); const v = String(new FormData(e.currentTarget).get("rep") ?? "");
          run(async () => { const r = await assignHouses([h.id], v || null); onToast(r.ok ? { ok: true, text: "Asignación guardada." } : { ok: false, text: r.error }); if (r.ok) { setMode(null); onReload(); } });
        }}>
          <select name="rep" className="input flex-1" defaultValue={h.assignedId ?? ""} aria-label="Vendedor">
            <option value="">Sin asignar</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-primary btn-sm" disabled={saving}>Guardar</button>
        </form>
      )}
      {mode === "history" && <HouseHistory houseId={h.id} />}
    </div>
  );
}

function LeadForm({ h, streetId, onDone }: { h: IntelHouse; streetId: string; onDone: (ok: boolean, text: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [first, last] = useMemo(() => {
    const o = (h.owner ?? "").trim();
    if (!o || /\b(LLC|INC|TRUST|LP|LTD|CORP|HOMES|ESTATE|PROPERTIES|ASSOC)\b/i.test(o)) return ["", ""];
    const p = o.split(/\s*&\s*/)[0].split(/\s+/); // registros: APELLIDO NOMBRE
    const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
    return p.length >= 2 ? [cap(p[1]), cap(p[0])] : ["", cap(p[0])];
  }, [h.owner]);
  return (
    <form className="space-y-1.5 rounded-xl bg-canvas p-2.5" onSubmit={async (e) => {
      e.preventDefault(); if (saving) return; setSaving(true);
      const fd = new FormData(e.currentTarget); const g = (k: string) => String(fd.get(k) ?? "");
      const r = await createLeadFromHouse({ houseId: h.id, first: g("first"), last: g("last"), phone: g("phone"), email: g("email"), apptAt: g("appt") || undefined }).catch(() => null);
      setSaving(false);
      if (!r) onDone(false, "Sin conexión: no se creó el lead."); else onDone(r.ok, r.ok ? `Lead #${r.number} creado y enlazado.` : r.error);
    }}>
      <div className="text-xs font-semibold">Nuevo lead · {h.situs}</div>
      {h.owner && <p className="text-[11px] text-muted">Dueño según el condado: {h.owner}. Confirma el nombre.</p>}
      <div className="grid grid-cols-2 gap-1.5">
        <input name="first" className="input" placeholder="Nombre" defaultValue={first} required aria-label="Nombre" />
        <input name="last" className="input" placeholder="Apellido" defaultValue={last} aria-label="Apellido" />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <input name="phone" className="input" type="tel" inputMode="tel" placeholder="Teléfono" aria-label="Teléfono" />
        <input name="email" className="input" type="email" placeholder="Correo" aria-label="Correo" />
      </div>
      <label className="text-[11px] text-muted block">Inspección (opcional)<input name="appt" type="datetime-local" className="input mt-0.5" /></label>
      <div className="flex gap-1.5">
        <button className="btn-primary btn-sm flex-1" disabled={saving}>{saving ? "Creando…" : "Crear lead"}</button>
        <Link className="btn-secondary btn-sm" href={`/trabajos/nuevo?calle=${streetId}&casa=${h.id}`}>Formulario completo</Link>
      </div>
    </form>
  );
}

function HouseHistory({ houseId }: { houseId: string }) {
  const [ev, setEv] = useState<IntelEvent[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getHouseHistory(houseId).then((r) => (r.ok ? setEv(r.events) : setErr(r.error))).catch(() => setErr("Sin conexión.")); }, [houseId]);
  if (err) return <p className="text-xs text-red-700">{err}</p>;
  if (!ev) return <div className="skel h-10" />;
  if (!ev.length) return <p className="text-xs text-muted">Sin cambios registrados todavía.</p>;
  return <EventList events={ev} />;
}

function EventList({ events, houses }: { events: IntelEvent[]; houses?: IntelHouse[] }) {
  const byId = houses ? new Map(houses.map((h) => [h.id, h.situs])) : null;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="text-xs flex gap-2">
          <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: e.status && e.status in HOUSE_STATUS ? HOUSE_STATUS[e.status as HouseStatus].color : "#9ca3af" }} />
          <span className="min-w-0">
            <span className="font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</span>
            {e.status && e.status in HOUSE_STATUS && <> · {HOUSE_STATUS[e.status as HouseStatus].label}</>}
            {byId && <> · {byId.get(e.houseId) ?? "casa"}</>}
            {e.note && <span className="block text-muted">{e.note}</span>}
            <span className="block text-muted">{fmtDateTime(e.at)} · {e.actor ?? "—"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function HistoryTab({ events, houses }: { events: IntelEvent[]; houses: IntelHouse[] }) {
  if (!events.length) return <p className="text-sm text-muted py-4 text-center">Todavía no hay cambios registrados por casa en esta calle.</p>;
  return <div className="space-y-2"><p className="text-xs text-muted">Últimos {events.length} cambios (todas las casas).</p><EventList events={events} houses={houses} /></div>;
}

// =====================================================================
function StormTab({ intel, onFocus }: { intel: StreetIntel; onFocus: (f: MapFocus) => void }) {
  const p = intel.priority;
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold text-sm">{PRIORITY_LABEL[p.level as keyof typeof PRIORITY_LABEL]}{p.level !== "sin_datos" && <span className="text-muted font-normal"> · {p.score} de {p.max} puntos</span>}</div>
          <button type="button" className="link text-xs" onClick={() => setShow(!show)} aria-expanded={show}>{show ? "Ocultar" : "Ver"} criterios</button>
        </div>
        {show && (
          <ul className="mt-2 space-y-1 text-xs">
            {p.parts.map((x) => <li key={x.key} className="flex justify-between gap-2"><span>{x.label}: <b>{x.value}</b></span><span className="tnum text-muted">+{x.score}</span></li>)}
            <li className="text-muted pt-1">Pesos en <code>lib/street-intel.ts</code> (PRIORITY_WEIGHTS). Ventana: {PRIORITY_WINDOW_DAYS / 365} años.</li>
          </ul>
        )}
        <p className="text-[11px] text-muted mt-2">Indica dónde conviene tocar primero. No confirma que alguna casa tenga daños; eso solo lo dice una inspección.</p>
      </div>
      {intel.storms.length === 0 ? (
        <p className="text-sm text-muted text-center py-4">No hay reportes ni áreas de radar a {STORM_RADIUS_MI} mi de esta calle en los datos cargados. Esto no significa que no haya caído granizo: puede faltar información.</p>
      ) : (
        <ol className="space-y-2">
          {intel.storms.map((c) => <StormCardView key={c.key} c={c} onFocus={onFocus} />)}
        </ol>
      )}
      <p className="text-[11px] text-muted"><b>Observado</b>: reporte en tierra de NWS/NOAA (punto). <b>Estimado</b>: área calculada por radar (HailPoint o NOAA NEXRAD); no es una medición en la casa.</p>
    </div>
  );
}

function StormCardView({ c, onFocus }: { c: StormCard; onFocus: (f: MapFocus) => void }) {
  const obs = c.kind === "observado";
  const big = c.type === "granizo" ? (c.sizeIn != null ? `${c.sizeIn.toFixed(2)}"` : "tamaño sin dato") : c.windMph != null ? `${c.windMph} mph` : "velocidad sin dato";
  return (
    <li>
      <button type="button" disabled={!c.focus} onClick={() => c.focus && onFocus(c.focus)}
        className="w-full text-left rounded-xl border border-line p-3 hover:border-ink/25 disabled:hover:border-line">
        <div className="flex items-center gap-2">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c.type === "granizo" ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-700"}`}>
            <Icon name={c.type === "granizo" ? "storm" : "wind"} className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">{c.type === "granizo" ? "Granizo" : "Viento"} · {big}</div>
            <div className="text-[11px] text-muted">{fmtDate(c.date)}{c.distanceMi != null && (c.distanceMi > 0 ? ` · a ${c.distanceMi} mi` : " · sobre la calle")}</div>
          </div>
          <span className={`chip border-0 text-[11px] ${obs ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{obs ? "Observado" : "Estimado"}</span>
        </div>
        <div className="mt-1.5 text-[11px] text-muted">{c.source} · confianza {c.confidence}{c.place ? ` · ${c.place}` : ""}</div>
        {c.note && <div className="text-[11px] text-muted">{c.note}</div>}
        {c.focus && <div className="text-[11px] font-semibold text-brand mt-1">Ver en el mapa →</div>}
      </button>
    </li>
  );
}

// =====================================================================
function CanvassTab({ intel, counts, addrOf, onStatus, onReload, onToast, onChanged }: {
  intel: StreetIntel; counts: ReturnType<typeof houseCounts>; addrOf: (h: IntelHouse) => string;
  onStatus: (h: IntelHouse, s: HouseStatus, k: "status" | "visit" | "skip", note?: string) => Promise<boolean>;
  onReload: () => void; onToast: (t: Toast) => void; onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState<string | null>(intel.mySession?.lastHouseId ?? null);
  const [skipFor, setSkipFor] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const sess = intel.mySession;
  useEffect(() => { if (sess?.lastHouseId) setLastId((cur) => cur ?? sess.lastHouseId); }, [sess?.lastHouseId]);
  const skipped = useMemo(() => new Set(intel.events.filter((e) => e.kind === "skip" && sess && e.sessionId === sess.id).map((e) => e.houseId)), [intel.events, sess]);
  const order = useMemo(() => canvassOrder(intel.houses.map((h) => ({ ...h, house_number: h.number }))), [intel.houses]);
  const next = nextHouse(order, lastId, skipped) as (IntelHouse & { house_number: number | null }) | null;
  const others = intel.sessions.filter((x) => !sess || x.id !== sess.id);

  if (done) return <div className="rounded-xl bg-emerald-50 p-4 space-y-2"><p className="font-semibold text-emerald-800">Recorrido terminado</p><p className="text-sm whitespace-pre-line">{done}</p><button type="button" className="btn-secondary btn-sm" onClick={() => setDone(null)}>Cerrar</button></div>;

  if (!intel.houses.length) return <p className="text-sm text-muted text-center py-4">Esta calle no tiene casas cargadas. El recorrido necesita la lista de casas del condado.</p>;

  if (!sess) {
    return (
      <div className="space-y-3">
        {others.length > 0 && (
          <p className="text-sm rounded-xl bg-amber-50 text-amber-900 p-3"><b>{others.map((o) => o.userName ?? "Otro vendedor").join(", ")}</b> {others.length > 1 ? "están" : "está"} recorriendo esta calle ahora. Coordinen para no tocar las mismas puertas.</p>
        )}
        <div className="rounded-xl border border-line p-3 text-sm space-y-1">
          <div><b>{order.length}</b> casas por tocar · {counts.by.do_not_contact} con "No contactar" (se excluyen)</div>
          <div className="text-xs text-muted">{ORDER_NOTE}</div>
          <div className="text-xs text-muted">No se usa tu ubicación GPS. Las visitas se marcan solo cuando tú tocas un resultado.</div>
        </div>
        <button type="button" className="btn-primary w-full min-h-[48px]" disabled={saving || !order.length} onClick={async () => {
          setSaving(true); const r = await startCanvass(intel.street.id).catch(() => null); setSaving(false);
          if (!r || !r.ok) onToast({ ok: false, text: r && !r.ok ? r.error : "Sin conexión." });
          else { onToast({ ok: true, text: r.resumed ? "Continuando tu recorrido." : "Recorrido iniciado." }); onReload(); }
        }}><Icon name="play" className="w-4 h-4" />{saving ? "Iniciando…" : order.length ? "Iniciar recorrido" : "No quedan casas pendientes"}</button>
      </div>
    );
  }

  const stat = (l: string, v: number | string) => <div className="rounded-xl bg-canvas px-2 py-1.5 text-center"><div className="font-bold tnum">{v}</div><div className="text-[10px] text-muted">{l}</div></div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        {stat("Total", counts.total)}{stat("Visitadas", counts.worked)}{stat("Pendientes", counts.pending)}
        {stat("Leads (sesión)", sess.leads)}{stat("Citas (sesión)", sess.appointments)}{stat("Avance", `${counts.pct}%`)}
      </div>
      <p className="text-[11px] text-muted">Recorrido desde {fmtDateTime(sess.startedAt)} · {sess.visited} visitas y {sess.skipped} saltadas en esta sesión. {ORDER_NOTE}</p>
      {others.length > 0 && <p className="text-xs rounded-lg bg-amber-50 text-amber-900 px-2.5 py-1.5">También recorriendo: {others.map((o) => o.userName ?? "otro vendedor").join(", ")}.</p>}

      {next ? (
        <div className="rounded-2xl border-2 border-night p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">Siguiente casa</div>
              <div className="font-bold text-lg leading-tight">{next.situs}</div>
              <div className="text-xs text-muted truncate">{next.owner ?? "Dueño sin dato"}</div>
            </div>
            <StatusPill s={next.status} small />
          </div>
          {!skipFor ? (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {VISIT_RESULTS.map((k) => (
                  <button key={k} type="button" disabled={saving} className="flex items-center justify-center gap-1.5 rounded-xl min-h-[52px] font-semibold text-sm disabled:opacity-50"
                    style={{ background: HOUSE_STATUS[k].bg, color: HOUSE_STATUS[k].color }}
                    onClick={async () => {
                      if (k === "do_not_contact" && armed !== next.id) { setArmed(next.id); return; }
                      setArmed(null); setSaving(true); const ok = await onStatus(next, k, "visit"); setSaving(false); if (ok) setLastId(next.id);
                    }}>
                    <Icon name={HOUSE_STATUS[k].icon} className="w-4 h-4" strokeWidth={2.25} />{k === "do_not_contact" && armed === next.id ? "Toca otra vez" : HOUSE_STATUS[k].label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => setSkipFor(true)}><Icon name="skip" className="w-4 h-4" />Saltar</button>
                <a className="btn-secondary btn-sm flex-1" href={nav(addrOf(next)).google} target="_blank" rel="noopener noreferrer"><Icon name="navigation" className="w-4 h-4" />Navegar</a>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-muted py-1">Más acciones (lead, nota, inspección)</summary>
                <div className="pt-2"><HouseActions compact h={next} intel={intel} users={[]} addr={addrOf(next)} onStatus={onStatus} onReload={onReload} onToast={onToast} onChanged={onChanged} /></div>
              </details>
            </>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">¿Por qué la saltas?</div>
              {SKIP_REASONS.map((r) => (
                <button key={r} type="button" disabled={saving} className="w-full text-left rounded-xl border border-line px-3 min-h-[44px] text-sm disabled:opacity-50"
                  onClick={async () => { setSaving(true); const ok = await onStatus(next, next.status, "skip", r); setSaving(false); if (ok) { setLastId(next.id); setSkipFor(false); } }}>{r}</button>
              ))}
              <button type="button" className="link text-xs" onClick={() => setSkipFor(false)}>Cancelar</button>
            </div>
          )}
        </div>
      ) : <p className="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-sm font-semibold">No quedan casas pendientes en esta calle.</p>}

      {!finishing ? (
        <button type="button" className="btn-dark w-full" onClick={() => setFinishing(true)}><Icon name="flag" className="w-4 h-4" />Terminar recorrido</button>
      ) : (
        <form className="space-y-1.5" onSubmit={async (e) => {
          e.preventDefault(); if (saving) return;
          const note = String(new FormData(e.currentTarget).get("note") ?? "");
          const summary = `${sess.visited} visitas · ${sess.skipped} saltadas · ${sess.leads} leads · ${sess.appointments} citas. Calle al ${counts.pct}%.${note ? `\n${note}` : ""}`;
          setSaving(true); const r = await finishCanvass(sess.id, summary).catch(() => null); setSaving(false);
          if (!r || !r.ok) onToast({ ok: false, text: r && !r.ok ? r.error : "Sin conexión." }); else { setDone(summary); setFinishing(false); onReload(); onChanged(); }
        }}>
          <textarea name="note" className="input py-2" rows={2} placeholder="Comentario del recorrido (opcional)" aria-label="Comentario" maxLength={600} />
          <div className="flex gap-1.5"><button className="btn-primary btn-sm flex-1" disabled={saving}>Guardar resumen y terminar</button><button type="button" className="btn-secondary btn-sm" onClick={() => setFinishing(false)}>Cancelar</button></div>
        </form>
      )}
    </div>
  );
}
