import { StatusPill } from "@/components/HouseStatus";
import { isHouseStatus } from "@/lib/street-intel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoadOwners } from "./LoadOwners";
import { ProgressBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate, fmtDateTime, mapsHref } from "@/lib/format";
import { updateStreet } from "../actions";

const ST: Record<string, { l: string; c: string }> = {
  pendiente: { l: "Pendiente", c: "bg-canvas text-ink/70 border-line" },
  en_progreso: { l: "En progreso", c: "bg-amber-50 text-amber-800 border-amber-200" },
  terminada: { l: "Terminada", c: "bg-green-50 text-green-800 border-green-200" },
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
    .select("id, street_id, house_number, situs, owner_name, owner_occupied, year_built, status, job_id")
    .in("street_id", streets.map((s) => s.id)).order("house_number").limit(5000) : { data: [] as any[] };
  const housesBy = new Map<string, any[]>();
  for (const h of (hs ?? []) as any[]) { if (!housesBy.has(h.street_id)) housesBy.set(h.street_id, []); housesBy.get(h.street_id)!.push(h); }
  const ownersPending = streets.filter((s) => !s.owners_loaded_at).length;
  const done = streets.filter((s) => s.status === "terminada").length;

  return (
    <>
      <Link href="/territorios" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><Icon name="chevronLeft" className="w-4 h-4" />Calles</Link>
      <div className="flex gap-3 mt-1 mb-2">
        <div className="w-12 h-12 shrink-0 rounded-xl bg-night text-white flex items-center justify-center text-lg font-semibold">{z.code}</div>
        <div className="min-w-0">
          <h1 className="h1 leading-tight">{z.name}</h1>
          <p className="muted">{z.city} {z.zip} · Granizo {z.hail} · tormenta {fmtDate(z.storm_date)}</p>
        </div>
      </div>
      {z.description && <p className="text-sm text-ink/80 mb-3">{z.description}</p>}
      <div className="card p-3 mb-4">
        <div className="flex justify-between text-sm mb-1.5"><span className="font-medium">{done} de {streets.length} calles terminadas</span><span className="text-muted tnum">{streets.reduce((a, s) => a + (s.doors_knocked ?? 0), 0)} puertas · {streets.reduce((a, s) => a + (s.leads ?? 0), 0)} leads</span></div>
        <ProgressBar value={done} max={streets.length} label="Calles terminadas" />
      </div>
      {profile.role === "administrador" && <LoadOwners territoryId={z.id} pending={ownersPending} />}

      <ul className="space-y-2.5">
        {streets.map((s) => {
          const action = updateStreet.bind(null, s.id, z.id);
          const st = ST[s.status] ?? ST.pendiente;
          return (
            <li key={s.id} className={`card p-3 ${s.status === "terminada" ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`font-semibold ${s.status === "terminada" ? "line-through text-muted" : ""}`}>{s.name}</div>
                  <div className="text-xs text-muted">
                    {s.doors_knocked} puertas · {s.leads} leads
                    {s.last_visit_at && ` · ${fmtDateTime(s.last_visit_at)}${s.visitor?.full_name ? " por " + s.visitor.full_name : ""}`}
                  </div>
                </div>
                <span className={`chip ${st.c}`}>{st.l}</span>
              </div>
              {s.notes && <p className="text-sm text-gray-700 mt-1.5 whitespace-pre-wrap">{s.notes}</p>}
              <div className="grid grid-cols-4 gap-2 mt-3">
                <form action={action}><input type="hidden" name="add_doors" value="1" /><button className="btn-secondary w-full px-1 btn-sm min-h-[44px]">+1 puerta</button></form>
                <form action={action}><input type="hidden" name="add_doors" value="5" /><button className="btn-secondary w-full px-1 btn-sm min-h-[44px]">+5</button></form>
                <Link href={`/trabajos/nuevo?calle=${s.id}`} className="btn-primary px-1 btn-sm min-h-[44px]">+ Lead</Link>
                <a href={mapsHref([s.name, z.city, "TX", z.zip])} target="_blank" rel="noopener" className="btn-secondary px-1 btn-sm min-h-[44px]"><Icon name="route" className="w-4 h-4" />Ir</a>
              </div>
              <Link href={`/mapa?calle=${s.id}`} className="mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-night text-white text-sm font-semibold min-h-[44px]">
                <Icon name="streets" className="w-4 h-4" />Abrir calle en el mapa (casas, recorrido, tormentas)
              </Link>
              {(housesBy.get(s.id)?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="text-sm font-medium text-muted cursor-pointer">Casas y dueños ({housesBy.get(s.id)!.length})</summary>
                  <ul className="mt-2 divide-y divide-line/70 text-sm">
                    {housesBy.get(s.id)!.map((h) => (
                      <li key={h.id} className="py-1.5 flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-semibold">{h.house_number ?? ""}</span> · {h.owner_name ?? "—"}
                          <span className="block text-xs text-muted">
                            {h.owner_occupied ? "Vive ahí" : "Dueño no vive ahí (posible renta)"}{h.year_built ? ` · construida ${h.year_built}` : ""}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          {isHouseStatus(h.status) && h.status !== "not_visited" && <StatusPill s={h.status} small />}
                          {h.job_id ? <Link href={`/trabajos/${h.job_id}`} className="text-xs font-bold text-ink py-1">Ver lead</Link>
                            : h.status === "do_not_contact" ? null
                            : <Link href={`/trabajos/nuevo?calle=${s.id}&casa=${h.id}`} className="text-xs font-bold text-brand py-1">+ Lead</Link>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {s.owners_status === "sin_casas" && <p className="text-xs text-gray-500 mt-2">El condado no tiene casas residenciales con esta calle.</p>}
              <details className="mt-2">
                <summary className="text-sm font-medium text-muted cursor-pointer">Estado y notas</summary>
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
