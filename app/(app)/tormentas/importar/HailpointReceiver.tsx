"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { importHailpointMap } from "../actions";

// Recibe mapas de HailPoint desde la pestaña de HailPoint del administrador (window.postMessage).
// Solo acepta mensajes de www.hailpoint.com y solo funciona para administradores (la acción lo verifica).
const ORIGIN = "https://www.hailpoint.com";
type Msg = { type: "hp-map"; region: string; id: string; date: string; polygons: { label: string; pts: [number, number][] }[] };

export function HailpointReceiver() {
  const [log, setLog] = useState<string[]>([]);
  const busy = useRef(Promise.resolve());
  useEffect(() => {
    const add = (t: string) => setLog((l) => [...l, t]);
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== ORIGIN) return;
      const d = ev.data as Msg;
      if (!d || d.type !== "hp-map") return;
      const src = ev.source as Window | null;
      busy.current = busy.current.then(async () => {
        add(`Guardando mapa del ${d.date} (${d.polygons.length} polígonos)…`);
        const r = await importHailpointMap({ region: d.region, id: d.id, date: d.date, polygons: d.polygons }).catch((e) => ({ ok: false as const, error: String(e) }));
        const line = r.ok ? `✓ ${d.date}: ${r.swaths} franjas ≥1.75", ${r.stats} ZIP con granizo` : `✗ ${d.date}: ${r.error}`;
        add(line);
        src?.postMessage({ type: "hp-saved", id: d.id, ok: r.ok, line }, ORIGIN);
      });
    }
    window.addEventListener("message", onMsg);
    window.opener?.postMessage({ type: "crm-ready" }, ORIGIN);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return (
    <div className="space-y-3">
      <h1 className="h1">Importar mapas de HailPoint</h1>
      <p className="text-sm text-gray-600">Esta página recibe los mapas que se envían desde HailPoint (con tu sesión de HailPoint abierta). Déjala abierta hasta que termine.</p>
      <ul className="card p-3 text-sm space-y-1" aria-live="polite">
        {log.length ? log.map((l, i) => <li key={i}>{l}</li>) : <li className="muted">Esperando datos…</li>}
      </ul>
      <Link href="/mapa" className="btn-secondary">Ir al mapa</Link>
    </div>
  );
}
