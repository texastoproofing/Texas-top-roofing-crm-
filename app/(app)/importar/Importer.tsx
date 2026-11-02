"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { parseTrelloExport, type ImportRow } from "@/lib/trello";
import { statusInfo } from "@/lib/constants";
import { fmtDate } from "@/lib/format";
import { importTrello } from "./actions";

export function Importer({ users, me }: { users: { id: string; full_name: string }[]; me: string }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [owner, setOwner] = useState(me);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const [pending, start] = useTransition();

  async function onFile(f: File | undefined) {
    setErr(null); setResult(null); setRows(null);
    if (!f) return;
    try {
      const parsed = parseTrelloExport(JSON.parse(await f.text()));
      if (parsed.length === 0) setErr("No encontré tarjetas abiertas en ese archivo. ¿Es el JSON exportado del tablero?");
      setRows(parsed);
    } catch {
      setErr("Ese archivo no es un JSON válido de Trello.");
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-4 space-y-3">
        <ol className="list-decimal ml-5 text-sm text-gray-700 space-y-1">
          <li>En Trello abre el tablero <b>TEXAS TOP ROOFING</b> desde una computadora.</li>
          <li>Menú (⋯) → <b>Imprimir, exportar y compartir</b> → <b>Exportar como JSON</b>. Guarda el archivo.</li>
          <li>Súbelo aquí, revisa la vista previa y pulsa <b>Importar</b>.</li>
        </ol>
        <input type="file" accept="application/json,.json" className="input py-2" onChange={(e) => onFile(e.target.files?.[0])} />
        {err && <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{err}</p>}
      </section>

      {rows && rows.length > 0 && (
        <section className="card p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-end justify-between">
            <div>
              <h2 className="h2">{rows.length} tarjetas encontradas</h2>
              <p className="muted">Cada tarjeta crea un contacto y un trabajo. La descripción completa se guarda en las notas. Si una tarjeta ya se importó, se salta.</p>
            </div>
            <div className="flex gap-2 items-end">
              <div>
                <label className="label">Asignar a</label>
                <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <button className="btn-primary" disabled={pending}
                onClick={() => start(async () => setResult(await importTrello(rows, owner)))}>
                {pending ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
          {result && (
            <div className="rounded-lg bg-green-50 text-green-800 text-sm p-3">
              Listo: {result.created} creados, {result.skipped} ya existían.{" "}
              <Link href="/trabajos" className="font-semibold underline">Ver trabajos</Link>
              {result.errors.length > 0 && <ul className="text-red-700 mt-2 list-disc ml-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
            </div>
          )}
          <div className="overflow-x-auto -mx-4">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500">
                <tr><th className="p-2 pl-4">Cliente</th><th className="p-2">Lista → estado</th><th className="p-2">Aseguradora</th><th className="p-2">Teléfono</th><th className="p-2">Dirección</th><th className="p-2">Claim</th><th className="p-2 pr-4">DOL</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.cardId}>
                    <td className="p-2 pl-4 font-semibold">{r.first_name} {r.last_name}</td>
                    <td className="p-2">{r.list} → {statusInfo(r.status).label}</td>
                    <td className="p-2">{r.insurer ?? "—"}</td>
                    <td className="p-2">{r.phone ?? "—"}</td>
                    <td className="p-2">{[r.address, r.city, r.zip].filter(Boolean).join(", ") || "—"}</td>
                    <td className="p-2">{r.claim_number ?? "—"}</td>
                    <td className="p-2 pr-4">{fmtDate(r.date_of_loss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Los campos en “—” no se detectaron con seguridad; quedan en las notas y se pueden completar después en cada trabajo.</p>
        </section>
      )}
    </div>
  );
}
