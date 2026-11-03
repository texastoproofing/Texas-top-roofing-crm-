import Link from "next/link";
import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { APPT_KINDS, apptLabel, TZ } from "@/lib/constants";
import { fmtTime, localToISO, mapsHref, todayTX } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createAppointment, deleteAppointment } from "./actions";

function addDays(ymd: string, n: number) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const dayTitle = (ymd: string) =>
  new Date(ymd + "T12:00:00Z").toLocaleDateString("es-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function CalendarPage({ searchParams }: { searchParams: { desde?: string; quien?: string; nueva?: string } }) {
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
      <PageHeader title="Agenda" sub="Próximos 7 días · hora de Texas"
        action={<a href="#nueva-cita" className="btn-primary"><Icon name="plus" className="w-4 h-4" /><span className="hidden sm:inline">Nueva cita</span></a>} />
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="seg">
          <Link href={link({ desde: addDays(from, -7) })} aria-label="Semana anterior"><Icon name="chevronLeft" className="w-4 h-4" /></Link>
          <Link href={link({ desde: todayTX() })} aria-current={from === todayTX() ? "page" : undefined}>Hoy</Link>
          <Link href={link({ desde: to })} aria-label="Semana siguiente"><Icon name="chevronRight" className="w-4 h-4" /></Link>
        </div>
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="desde" value={from} />
          <select name="quien" defaultValue={who} className="input w-auto min-h-[40px] text-sm" aria-label="Persona">
            <option value="todos">Todo el equipo</option>
            {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <button className="btn-secondary btn-sm">Ver</button>
        </form>
      </div>

      <div className="card divide-y divide-line/70">
        {days.map((d) => {
          const list = appts.filter((a) => dayKey(a.starts_at) === d);
          const isToday = d === todayTX();
          return (
            <section key={d} className="flex gap-3 px-4 py-3">
              <div className="w-12 shrink-0 text-center">
                <div className={`text-[11px] uppercase ${isToday ? "text-brand font-semibold" : "text-muted"}`}>{new Date(d + "T12:00:00Z").toLocaleDateString("es-US", { weekday: "short", timeZone: "UTC" })}</div>
                <div className={`mx-auto mt-0.5 w-9 h-9 rounded-full flex items-center justify-center text-base font-semibold ${isToday ? "bg-brand text-white" : ""}`}>{Number(d.slice(8))}</div>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="sr-only">{dayTitle(d)}</h2>
                {list.length === 0 ? <p className="text-sm text-muted pt-2.5">Libre</p> : (
                  <ul className="space-y-2">
                    {list.map((a) => (
                      <li key={a.id} className="flex gap-3 rounded-lg border border-line p-2.5">
                        <div className="w-14 shrink-0 text-sm font-semibold tnum">{fmtTime(a.starts_at)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{a.job_id ? <Link href={`/trabajos/${a.job_id}`}>{a.title}</Link> : a.title}</div>
                          <div className="text-xs text-muted">{[apptLabel(a.kind), a.assignee?.full_name].filter(Boolean).join(" · ")}</div>
                          {a.location && <a className="text-xs text-brand font-medium" href={mapsHref([a.location])} target="_blank" rel="noopener">{a.location}</a>}
                        </div>
                        <form action={deleteAppointment.bind(null, a.id, a.job_id)}>
                          <button className="text-muted hover:text-red-600 p-1" aria-label="Borrar cita"><Icon name="x" className="w-4 h-4" /></button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <details id="nueva-cita" className="card p-4 mt-5 scroll-mt-20" open={!!searchParams.nueva}>
        <summary className="font-semibold text-brand cursor-pointer">+ Nueva cita (sin trabajo: reunión, recorrido, inspección…)</summary>
        <form action={createAppointment} className="grid sm:grid-cols-2 gap-3 mt-3">
          <div><label className="label">Título</label><input className="input" name="title" required autoFocus={!!searchParams.nueva} /></div>
          <div>
            <label className="label">Tipo</label>
            <select className="input" name="kind" defaultValue={APPT_KINDS.some((k) => k.key === searchParams.nueva) ? searchParams.nueva : "otra"}>
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
      {appts.length === 0 && <p className="muted mt-4">Consejo: para una inspección de un cliente, abre su trabajo y usa “Agendar cita”; así queda ligada al trabajo.</p>}
    </>
  );
}
