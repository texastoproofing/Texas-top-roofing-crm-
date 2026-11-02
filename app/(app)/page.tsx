import Link from "next/link";
import { getSession } from "@/lib/auth";
import { STAGES, STATUSES, apptLabel } from "@/lib/constants";
import { fmtDateTime, fmtTime, localToISO, todayTX } from "@/lib/format";
import { Empty, PageHeader, Stat } from "@/components/ui";

export default async function Dashboard() {
  const { supabase, profile } = await getSession();
  const today = todayTX();
  const start = localToISO(today + "T00:00")!;
  const end = new Date(new Date(start).getTime() + 24 * 3600 * 1000).toISOString();

  const [jobsRes, apptRes, tasksRes, actRes, streetsRes] = await Promise.all([
    supabase.from("jobs").select("status"),
    supabase.from("appointments").select("id, title, kind, starts_at, location, job_id, assigned_to")
      .gte("starts_at", start).lt("starts_at", end).order("starts_at"),
    supabase.from("tasks").select("id, title, due_at, job_id").eq("done", false).eq("assigned_to", profile.id)
      .order("due_at", { ascending: true, nullsFirst: false }).limit(8),
    supabase.from("activities").select("id, body, kind, created_at, job_id, author:profiles(full_name), job:jobs(name, number)")
      .order("created_at", { ascending: false }).limit(8),
    supabase.from("territory_streets").select("status"),
  ]);

  const jobs = jobsRes.data ?? [];
  const byStage = STAGES.map((s) => ({
    ...s,
    n: jobs.filter((j) => STATUSES.find((x) => x.key === j.status)?.stage === s.key).length,
  }));
  const streets = streetsRes.data ?? [];
  const doneStreets = streets.filter((s) => s.status === "terminada").length;
  const now = Date.now();

  return (
    <>
      <PageHeader title={`Hola, ${profile.full_name.split(" ")[0] || "equipo"}`} sub="Resumen de hoy"
        action={<Link href="/trabajos/nuevo" className="btn-primary">+ Lead</Link>} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {byStage.filter((s) => s.key !== "perdido" && s.key !== "completado").slice(0, 4).map((s) => (
          <Stat key={s.key} label={s.label} value={s.n} href={`/trabajos?etapa=${s.key}`} />
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="card p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="h2">Citas de hoy</h2>
            <Link href="/calendario" className="text-sm font-semibold text-brand">Agenda</Link>
          </div>
          {(apptRes.data ?? []).length === 0 ? <p className="muted">No hay citas hoy.</p> : (
            <ul className="divide-y divide-gray-100">
              {apptRes.data!.map((a) => (
                <li key={a.id} className="py-2.5 flex gap-3">
                  <div className="w-16 shrink-0 font-bold tabular-nums">{fmtTime(a.starts_at)}</div>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{a.job_id ? <Link href={`/trabajos/${a.job_id}`}>{a.title}</Link> : a.title}</div>
                    <div className="muted truncate">{apptLabel(a.kind)}{a.location ? ` · ${a.location}` : ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="h2">Mis tareas</h2>
            <Link href="/tareas" className="text-sm font-semibold text-brand">Ver todas</Link>
          </div>
          {(tasksRes.data ?? []).length === 0 ? <p className="muted">Sin tareas pendientes.</p> : (
            <ul className="divide-y divide-gray-100">
              {tasksRes.data!.map((t) => {
                const late = t.due_at && new Date(t.due_at).getTime() < now;
                return (
                  <li key={t.id} className="py-2.5">
                    <div className="font-semibold">{t.job_id ? <Link href={`/trabajos/${t.job_id}`}>{t.title}</Link> : t.title}</div>
                    {t.due_at && <div className={`text-sm ${late ? "text-red-600 font-semibold" : "text-gray-500"}`}>{late ? "Vencida · " : ""}{fmtDateTime(t.due_at)}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="h2">Door-to-door</h2>
            <Link href="/territorios" className="text-sm font-semibold text-brand">Calles</Link>
          </div>
          {streets.length === 0 ? <p className="muted">No hay territorios cargados.</p> : (
            <>
              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-green-600" style={{ width: `${(100 * doneStreets) / streets.length}%` }} />
              </div>
              <p className="muted mt-2">{doneStreets} de {streets.length} calles terminadas</p>
            </>
          )}
        </section>

        <section className="card p-4">
          <h2 className="h2 mb-3">Actividad reciente</h2>
          {(actRes.data ?? []).length === 0 ? <Empty>Todavía no hay actividad.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {actRes.data!.map((a: any) => (
                <li key={a.id} className="py-2.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold truncate">
                      {a.job ? <Link href={`/trabajos/${a.job_id}`}>#{a.job.number} {a.job.name}</Link> : "General"}
                    </span>
                    <span className="text-gray-400 shrink-0">{fmtDateTime(a.created_at)}</span>
                  </div>
                  <div className="text-gray-600 line-clamp-2">{a.author?.full_name ? `${a.author.full_name}: ` : ""}{a.body}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
