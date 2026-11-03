"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadOwners } from "../actions";

// Botón del administrador: carga los dueños calle por calle (lotes de 12) hasta terminar la zona.
export function LoadOwners({ territoryId, pending }: { territoryId: string; pending: number }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const r = await loadOwners(territoryId).catch(() => null);
      if (!r || !r.ok) { setMsg(r && !r.ok ? r.error : "Se interrumpió. Puedes reanudar."); break; }
      total += r.houses;
      setMsg(`Cargando… ${total} casas${r.remaining ? `, faltan ${r.remaining} calles` : ""}${r.notes.length ? ` · ${r.notes.join("; ")}` : ""}`);
      router.refresh();
      if (!r.remaining || r.notes.length) { if (!r.remaining) setMsg(`Listo: ${total} casas con dueño.`); break; }
    }
    setBusy(false);
  }
  return (
    <div className="card p-3 mb-4 space-y-1">
      <button type="button" className="btn-secondary" disabled={busy} onClick={run}>
        {busy ? "Cargando dueños…" : pending ? `Cargar dueños del condado (${pending} calles)` : "Actualizar dueños"}
      </button>
      <p className="text-xs text-gray-500">Registro público del distrito de tasación (Bexar, Williamson o Travis): dirección, dueño y si es su residencia.</p>
      {msg && <p className="text-sm" role="status">{msg}</p>}
    </div>
  );
}
