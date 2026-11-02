import Link from "next/link";
import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { APPT_KINDS, apptLabel, TZ } from "@/lib/constants";
import { fmtTime, localToISO, mapsHref, todayTX } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";
import { createAppointment, deleteAppointment } from "./actions";

function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const dayTitle = (ymd: string) =>
  new Date(ymd + "T12:00:00Z").toLocaleDateString("es-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function CalendarPage({ searchParams }: { searchParams: { desde?: string; quien?: string } }) {
  const { supabase, profile } = await getSession();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.desde ?? "") ? searchParams.desde! : todayTX();
  const to = addDays(from, 7);
  const who = searchParams.quien ?? (isStaff(profile) ? "todos" : profile.id);

  let q = supabase.from("appointments")
    .select("id, title, kind, starts_at, location, job_id, assignee:profiles!appointments_assigned_to_fkey(full_name)")
    .gte("starts_at", localToISO(from + "T00:00")!).lt("starts_at", localToISO(to + "T00:00")!).order("starts_at");
  if (who !== "todos") q = q.eq("assigned_to", who);
  const [{ data }, users] = await Promise.all([q, listProfiles()]);
  const appts = (data ?? []) as any[];
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  const link = (p: { desde?: string; quien?: string }) =>
    `/calendario?desde=${p.desde ?? from}&quien=${p.quien ?? who}`;

  return (
    <>
      <PageHeader title="Agenda" sub="Citas de los próximos 7 días (hora de Texas)" />
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <Link className="btn-secondary px-3" href={link({ desde: addDays(from, -7) })}>← Semana</Link>
        <Link className="btn-secondary px-3" href={link({ desde: todayTX() })}>Hoy</Link>
        <Link className="btn-secondary px-3" href={link({ desde: to })}>Semana →</Link>
        <form className="ml-auto">
          <input type="hidden" name="desde" value={from} />
          <select name="quien" defaultValue={who} className="input w-auto" aria-label="Persona">
            <option value="todos">Todo el equipo</option>
            {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <button className="btn-ghost px-3">Ver</button>
        </form>
      </div>

      <div className="space-y-4">
        {days.map((d) => {
          const list = appts.filter((a) => dayKey(a.starts_at) === d);
          return (
            <section key={d} className="card p-4">
              <h2 className={`font-bold capitalize mb-2 ${d === todayTX() ? "text-brand" : ""}`}>{dayTitle(d)}</h2>
              {list.length === 0 ? <p className="muted">Libre</p> : (
                <ul className="divide-y divide-gray-100">
                  {list.map((a) => (
                    <li key={a.id} className="flex gap-3 py-2.5">
                      <div className="w-16 shrink-0 font-bold tabular-nums">{fmtTime(a.starts_at)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{a.job_id ? <Link href={`/trabajos/${a.job_id}`}>{a.title}</Link> : a.title}</div>
                        <div className="muted">{[apptLabel(a.kind), a.assignee?.full_name].filter(Boolean).join(" · ")}</div>
                        {a.location && <a className="text-sm text-brand font-semibold" href={mapsHref([a.location])} target="_blank" rel="noopener">{a.location}</a>}
                      </div>
                      <form action={deleteAppointment.bind(null, a.id, a.job_id)}>
                        <button className="text-gray-400 hover:text-red-600 text-sm px-1" aria-label="Borrar cita">✕</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <details className="card p-4 mt-5">
        <summary className="font-semibold text-brand cursor-pointer">+ Cita sin trabajo (reunión, recorrido…)</summary>
        <form action={createAppointment} className="grid sm:grid-cols-2 gap-3 mt-3">
          <div><label className="label">Título</label><input className="input" name="title" required /></div>
          <div>
            <label className="label">Tipo</label>
            <select className="input" name="kind" defaultValue="otra">
              {APPT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
          <div><label className="label">Fecha y hora</label><input className="input" name="starts_at" type="datetime-local" required /></div>
          <div>
            <label className="label">Asignada a</label>
            <select className="input" name="assigned_to" defaultValue={profile.id}>
              {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><label className="label">Lugar</label><input className="input" name="location" /></div>
          <button className="btn-primary sm:col-span-2">Guardar cita</button>
        </form>
      </details>
      {appts.length === 0 && <div className="mt-4"><Empty>Para agendar una inspección, abre el trabajo y usa “Agendar cita”.</Empty></div>}
    </>
  );
}
