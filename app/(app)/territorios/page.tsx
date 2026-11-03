import Link from "next/link";
import { getSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { Empty, PageHeader, ProgressBar } from "@/components/ui";
import { Icon } from "@/components/icons";

const REGIONS_D2D = [{ key: "austin", name: "Austin" }, { key: "san_antonio", name: "San Antonio" }];

export default async function TerritoriesPage() {
  const { supabase } = await getSession();
  const { data } = await supabase.from("territories")
    .select("id, code, name, city, zip, hail, storm_date, schedule, territory_streets(status, doors_knocked, leads)")
    .order("priority");
  const zones = (data ?? []) as any[];

  return (
    <>
      <PageHeader title="Calles" sub="Door-to-door por zonas dentro de la franja de granizo"
        action={<Link href="/mapa" className="btn-secondary"><Icon name="pin" className="w-4 h-4" /><span className="hidden sm:inline">Ver en el mapa</span></Link>} />
      {(() => {
        const all = zones.flatMap((z) => z.territory_streets as any[]);
        const done = all.filter((s) => s.status === "terminada").length;
        const doors = all.reduce((a, s) => a + (s.doors_knocked ?? 0), 0);
        const leads = all.reduce((a, s) => a + (s.leads ?? 0), 0);
        return all.length ? (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="card p-3"><div className="text-xs text-muted">Calles terminadas</div><div className="text-xl font-semibold tnum">{done}<span className="text-sm text-muted font-normal"> / {all.length}</span></div></div>
            <div className="card p-3"><div className="text-xs text-muted">Puertas</div><div className="text-xl font-semibold tnum">{doors}</div></div>
            <div className="card p-3"><div className="text-xs text-muted">Leads</div><div className="text-xl font-semibold tnum">{leads}</div></div>
          </div>
        ) : null;
      })()}
      {zones.length === 0 ? <Empty>No hay territorios. Corre el archivo supabase/migrations/0002_territorios.sql.</Empty> : (
        <div className="space-y-6">
          {REGIONS_D2D.map(({ key, name }) => {
            const list = zones.filter((z) => (String(z.code).startsWith("S") ? "san_antonio" : "austin") === key);
            if (!list.length) return null;
            return (
              <section key={key}>
                <h2 className="eyebrow mb-2">{name}</h2>
          <div className="grid sm:grid-cols-2 gap-3">
          {list.map((z) => {
            const st = z.territory_streets as { status: string; doors_knocked: number; leads: number }[];
            const done = st.filter((s) => s.status === "terminada").length;
            const doors = st.reduce((a, s) => a + (s.doors_knocked ?? 0), 0);
            const leads = st.reduce((a, s) => a + (s.leads ?? 0), 0);
            return (
              <Link key={z.id} href={`/territorios/${z.id}`} className="card p-4 block hover:shadow-pop transition">
                <div className="flex gap-3">
                  <div className="w-11 h-11 shrink-0 rounded-xl bg-night text-white flex items-center justify-center text-base font-semibold">{z.code}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold leading-tight">{z.name}</div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {z.hail && <span className="chip bg-brand-soft text-brand border-transparent">Granizo {z.hail}</span>}
                      <span className="chip bg-canvas border-line text-ink/80">{z.city} {z.zip}</span>
                      {z.schedule && <span className="chip bg-canvas border-line text-ink/80">{z.schedule}</span>}
                    </div>
                    <div className="mt-3"><ProgressBar value={done} max={st.length} label={`Calles terminadas zona ${z.code}`} /></div>
                    <div className="text-xs text-muted mt-1.5">
                      {done}/{st.length} calles · {doors} puertas · {leads} leads · tormenta {fmtDate(z.storm_date)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted mt-5">
        El tamaño viene del radar y tiene margen de unas cuadras. Di “el radar registró granizo grande en este vecindario”, nunca “su techo está dañado”.
        Confirma el permiso de solicitación de cada ciudad.
      </p>
    </>
  );
}
