import Link from "next/link";
import { getSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

export default async function TerritoriesPage() {
  const { supabase } = await getSession();
  const { data } = await supabase.from("territories")
    .select("id, code, name, city, zip, hail, storm_date, schedule, territory_streets(status, doors_knocked, leads)")
    .order("priority");
  const zones = (data ?? []) as any[];

  return (
    <>
      <PageHeader title="Calles door-to-door" sub="Zonas por prioridad dentro de la franja de granizo del radar"
        action={<Link href="/mapa" className="btn-secondary">Ver en el mapa</Link>} />
      {zones.length === 0 ? <Empty>No hay territorios. Corre el archivo supabase/migrations/0002_territorios.sql.</Empty> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {zones.map((z) => {
            const st = z.territory_streets as { status: string; doors_knocked: number; leads: number }[];
            const done = st.filter((s) => s.status === "terminada").length;
            const doors = st.reduce((a, s) => a + (s.doors_knocked ?? 0), 0);
            const leads = st.reduce((a, s) => a + (s.leads ?? 0), 0);
            return (
              <Link key={z.id} href={`/territorios/${z.id}`} className="card p-4 block hover:border-brand">
                <div className="flex gap-3">
                  <div className="text-3xl font-bold text-brand w-8">{z.code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold leading-tight">{z.name}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {z.hail && <span className="chip bg-brand-soft text-brand border-transparent">Radar {z.hail}</span>}
                      <span className="chip bg-gray-100 border-transparent">{z.city} {z.zip}</span>
                      {z.schedule && <span className="chip bg-gray-100 border-transparent">{z.schedule}</span>}
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden mt-3">
                      <div className="h-full bg-green-600" style={{ width: `${st.length ? (100 * done) / st.length : 0}%` }} />
                    </div>
                    <div className="text-xs text-gray-500 mt-1.5">
                      {done}/{st.length} calles · {doors} puertas · {leads} leads · tormenta {fmtDate(z.storm_date)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <p className="muted mt-5">
        El tamaño viene del radar y tiene margen de unas cuadras. Di “el radar registró granizo grande en este vecindario”, nunca “su techo está dañado”.
        Confirma el permiso de solicitación de cada ciudad.
      </p>
    </>
  );
}
