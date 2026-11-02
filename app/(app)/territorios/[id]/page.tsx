import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fmtDate, fmtDateTime, mapsHref } from "@/lib/format";
import { updateStreet } from "../actions";

const ST: Record<string, { l: string; c: string }> = {
  pendiente: { l: "Pendiente", c: "bg-gray-100 text-gray-700 border-gray-200" },
  en_progreso: { l: "En progreso", c: "bg-amber-100 text-amber-800 border-amber-200" },
  terminada: { l: "Terminada", c: "bg-green-100 text-green-800 border-green-200" },
};

export default async function TerritoryPage({ params }: { params: { id: string } }) {
  const { supabase } = await getSession();
  const { data: z } = await supabase.from("territories").select("*").eq("id", params.id).maybeSingle();
  if (!z) notFound();
  const { data } = await supabase.from("territory_streets")
    .select("id, name, status, doors_knocked, leads, notes, last_visit_at, visitor:profiles(full_name)")
    .eq("territory_id", z.id).order("position");
  const streets = (data ?? []) as any[];
  const done = streets.filter((s) => s.status === "terminada").length;

  return (
    <>
      <Link href="/territorios" className="text-sm font-semibold text-brand">← Zonas</Link>
      <div className="flex gap-3 mt-1 mb-2">
        <div className="text-4xl font-bold text-brand">{z.code}</div>
        <div>
          <h1 className="h1 leading-tight">{z.name}</h1>
          <p className="muted">{z.city} {z.zip} · Radar {z.hail} · tormenta {fmtDate(z.storm_date)}</p>
        </div>
      </div>
      {z.description && <p className="text-sm text-gray-700 mb-3">{z.description}</p>}
      <p className="text-sm font-semibold mb-4">{done} de {streets.length} calles terminadas</p>

      <ul className="space-y-3">
        {streets.map((s) => {
          const action = updateStreet.bind(null, s.id, z.id);
          const st = ST[s.status] ?? ST.pendiente;
          return (
            <li key={s.id} className={`card p-3 ${s.status === "terminada" ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`font-bold ${s.status === "terminada" ? "line-through" : ""}`}>{s.name}</div>
                  <div className="text-xs text-gray-500">
                    {s.doors_knocked} puertas · {s.leads} leads
                    {s.last_visit_at && ` · ${fmtDateTime(s.last_visit_at)}${s.visitor?.full_name ? " por " + s.visitor.full_name : ""}`}
                  </div>
                </div>
                <span className={`chip ${st.c}`}>{st.l}</span>
              </div>
              {s.notes && <p className="text-sm text-gray-700 mt-1.5 whitespace-pre-wrap">{s.notes}</p>}
              <div className="grid grid-cols-4 gap-2 mt-3">
                <form action={action}><input type="hidden" name="add_doors" value="1" /><button className="btn-secondary w-full px-1">+1 puerta</button></form>
                <form action={action}><input type="hidden" name="add_doors" value="5" /><button className="btn-secondary w-full px-1">+5</button></form>
                <Link href={`/trabajos/nuevo?calle=${s.id}`} className="btn-primary px-1">+ Lead</Link>
                <a href={mapsHref([s.name, z.city, "TX", z.zip])} target="_blank" rel="noopener" className="btn-secondary px-1">Mapa</a>
              </div>
              <details className="mt-2">
                <summary className="text-sm font-semibold text-gray-600 cursor-pointer">Estado y notas</summary>
                <form action={action} className="space-y-2 mt-2">
                  <select name="status" defaultValue={s.status} className="input">
                    <option value="pendiente">Pendiente</option>
                    <option value="en_progreso">En progreso</option>
                    <option value="terminada">Terminada</option>
                  </select>
                  <textarea name="notes" defaultValue={s.notes ?? ""} className="input py-2" rows={2}
                    placeholder="Ej.: #1201–1240 hechas; volver sábado a los que no abrieron" />
                  <button className="btn-primary w-full">Guardar</button>
                </form>
              </details>
            </li>
          );
        })}
      </ul>
    </>
  );
}
