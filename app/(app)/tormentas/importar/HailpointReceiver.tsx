"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { importHailpointMap } from "../actions";

// Recibe mapas de HailPoint en el fragmento de la dirección (#hp=...), preparado desde la pestaña de HailPoint
// del administrador. Nada se guarda hasta que el administrador revisa el resumen y toca "Importar".
type HpMap = { region: string; id: string; date: string; polygons: { label: string; pts: [number, number][] }[] };

export function HailpointReceiver() {
  const [maps, setMaps] = useState<HpMap[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const h = window.location.hash;
    if (!h.startsWith("#hp=")) return;
    try {
      const data = JSON.parse(decodeURIComponent(h.slice(4)));
      if (!Array.isArray(data)) throw new Error();
      setMaps(data.filter((m: any) => m && typeof m.id === "string" && typeof m.date === "string" && Array.isArray(m.polygons)));
    } catch { setErr("Los datos recibidos no son válidos."); }
    history.replaceState(null, "", window.location.pathname); // no dejar los datos en la dirección
  }, []);

  async function run() {
    if (!maps) return;
    setRunning(true);
    for (const m of maps) {
      setLog((l) => [...l, `Guardando ${m.date}…`]);
      const r = await importHailpointMap(m).catch((e) => ({ ok: false as const, error: String(e) }));
      setLog((l) => [...l.slice(0, -1), r.ok ? `✓ ${m.date}: ${r.swaths} franjas ≥1.75", ${r.stats} ZIP con granizo` : `✗ ${m.date}: ${r.error}`]);
    }
    setRunning(false);
    setMaps(null);
  }

  return (
    <div className="space-y-3">
      <h1 className="h1">Importar mapas de HailPoint</h1>
      {err && <p className="text-red-700">{err}</p>}
      {maps && (
        <section className="card p-3 space-y-2">
          <p className="text-sm">Se recibieron <b>{maps.length}</b> mapa(s) de HailPoint para <b>{maps[0]?.region === "san_antonio" ? "San Antonio" : maps[0]?.region}</b>:</p>
          <p className="text-xs text-gray-600">{maps.map((m) => `${m.date} (${m.polygons.length})`).join(" · ")}</p>
          <p className="text-xs text-gray-500">En esas fechas, HailPoint reemplaza al radar NEXRAD para no contar dos veces la misma tormenta.</p>
          <button type="button" className="btn-primary" disabled={running} onClick={run}>Importar</button>
        </section>
      )}
      {!maps && !log.length && !err && <p className="muted">No hay datos para importar. Los mapas se envían desde la pestaña de HailPoint.</p>}
      {log.length > 0 && <ul className="card p-3 text-sm space-y-1" aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {!running && log.length > 0 && <Link href="/mapa" className="btn-secondary">Ir al mapa</Link>}
    </div>
  );
}
