import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoadOwners } from "./LoadOwners";
import { fmtDate, fmtDateTime, mapsHref } from "@/lib/format";
import { updateStreet } from "../actions";

const ST: Record<string, { l: string; c: string }> = {
  pendiente: { l: "Pendiente", c: "bg-gray-100 text-gray-700 border-gray-200" },
  en_progreso: { l: "En progreso", c: "bg-amber-100 text-amber-800 border-amber-200" },
  terminada: { l: "Terminada", c: "bg-green-100 text-green-800 border-green-200" },
};

export default async function TerritoryPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await getSession();
  const { data: z } = await supabase.from("territories").select("*").eq("id", params.id).maybeSingle();
  if (!z) notFound();
  const { data } = await supabase.from("territory_streets")
    .select("id, name, status, doors_knocked, leads, notes, last_visit_at, owners_loaded_at, owners_status, visitor:profiles(full_name)")
    .eq("territory_id", z.id).order("position");
  const streets = (data ?? []) as any[];
  const { data: hs } = streets.length ? await supabase.from("street_houses")
    .select("id, street_id, house_number, situs, owner_name, owner_occupied, year_built")
    .in("street_id", streets.map((s) => s.id)).order("house_number").limit(5000) : { data: [] as any[] };
  const housesBy = new Map<string, any[]>();
  for (const h of (hs ?? []) as any[]) { if (!housesBy.has(h.street_id)) housesBy.set(h.street_id, []); housesBy.get(h.street_id)!.push(h); }
  const ownersPending = streets.filter((s) => !s.owners_loaded_at).length;
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
      {profile.role === "administrador" && <LoadOwners territoryId={z.id} pending={ownersPending} />}

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
              {(housesBy.get(s.id)?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="text-sm font-semibold text-gray-600 cursor-pointer">Casas y dueños ({housesBy.get(s.id)!.length})</summary>
                  <ul className="mt-2 divide-y divide-gray-100 text-sm">
                    {housesBy.get(s.id)!.map((h) => (
                      <li key={h.id} className="py-1.5 flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-semibold">{h.house_number ?? ""}</span> · {h.owner_name ?? "—"}
                          <span className="block text-xs text-gray-500">
                            {h.owner_occupied ? "Vive ahí" : "Dueño no vive ahí (posible renta)"}{h.year_built ? ` · construida ${h.year_built}` : ""}
                          </span>
                        </span>
                        <Link href={`/trabajos/nuevo?calle=${s.id}&casa=${h.id}`} className="text-xs font-bold text-brand shrink-0 py-1">+ Lead</Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {s.owners_status === "sin_casas" && <p className="text-xs text-gray-500 mt-2">El condado no tiene casas residenciales con esta calle.</p>}
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
