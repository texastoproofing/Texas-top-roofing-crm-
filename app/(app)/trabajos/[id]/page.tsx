import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, listProfiles } from "@/lib/auth";
import { APPT_KINDS, apptLabel, statusInfo } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMoney, fullName, mapsHref, telHref } from "@/lib/format";
import { KV, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatusSelect } from "@/components/StatusSelect";
import { ActivityFeed } from "@/components/ActivityFeed";
import { JobFields } from "@/components/JobForm";
import { TaskForm, TaskList } from "@/components/TaskList";
import { addJobNote, deleteJob, setJobStatus, updateJob } from "../actions";
import { createAppointment, deleteAppointment } from "../../calendario/actions";
import { JobFilesTab } from "./JobFilesTab";
import { JobFinance } from "./JobFinance";
import { JobReferences } from "@/components/JobReferences";

export default async function JobPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  const tab = searchParams.tab === "archivos" ? "archivos" : "resumen";
  const { supabase, profile } = await getSession();
  const { data: j } = await supabase.from("jobs")
    .select("*, contact:contacts(*), rep:profiles!jobs_sales_rep_id_fkey(full_name), pm:profiles!jobs_pm_id_fkey(full_name), territory:territories(code, name)")
    .eq("id", params.id).maybeSingle();
  if (!j) notFound();
  const c = (j as any).contact;

  const [acts, tasks, appts, users, terr] = await Promise.all([
    supabase.from("activities").select("id, kind, body, created_at, author:profiles(full_name)")
      .eq("job_id", j.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("tasks").select("id, title, description, due_at, done, job_id, assignee:profiles!tasks_assigned_to_fkey(full_name)")
      .eq("job_id", j.id).order("done").order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("appointments").select("id, title, kind, starts_at, location, assignee:profiles!appointments_assigned_to_fkey(full_name)")
      .eq("job_id", j.id).order("starts_at"),
    listProfiles(),
    supabase.from("territories").select("id, code, name").order("priority"),
  ]);
  const { count: fileCount } = await supabase.from("job_files").select("id", { count: "exact", head: true }).eq("job_id", j.id);
  const active = users.filter((u) => u.active);
  const addr = [j.address ?? c?.address, j.city ?? c?.city, j.zip ?? c?.zip].filter(Boolean);
  const map = addr.length ? mapsHref([...addr, "TX"]) : undefined;
  const st = statusInfo(j.status);

  return (
    <>
      <div className="mb-4">
        <Link href="/trabajos" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><Icon name="chevronLeft" className="w-4 h-4" />Trabajos</Link>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <h1 className="h1">{fullName(c) !== "Sin nombre" ? fullName(c) : j.name}</h1>
          <StatusBadge status={j.status} />
        </div>
        <p className="muted mt-0.5">
          #{j.number} · {j.name}
          {addr.length > 0 && <> · {addr.join(", ")}</>}
        </p>
        <div className="grid grid-cols-4 sm:flex sm:flex-wrap gap-2 mt-3">
          {c?.phone && <a className="btn-primary px-2 sm:px-4" href={telHref(c.phone)}><Icon name="phone" className="w-4 h-4" /><span className="text-xs sm:text-sm">Llamar</span></a>}
          {c?.phone && <a className="btn-secondary px-2 sm:px-4" href={"sms:" + c.phone.replace(/[^\d+]/g, "")}><Icon name="message" className="w-4 h-4" /><span className="text-xs sm:text-sm">Mensaje</span></a>}
          {map && <a className="btn-secondary px-2 sm:px-4" href={map} target="_blank" rel="noopener"><Icon name="pin" className="w-4 h-4" /><span className="text-xs sm:text-sm">Ir</span></a>}
          <Link className="btn-secondary px-2 sm:px-4" href={`/contactos/${c.id}`}><Icon name="contacts" className="w-4 h-4" /><span className="text-xs sm:text-sm">Cliente</span></Link>
        </div>
      </div>

      <nav className="sticky top-14 lg:top-0 z-20 -mx-4 px-4 lg:mx-0 lg:px-0 bg-canvas/95 backdrop-blur flex gap-1 border-b border-line mb-5 overflow-x-auto" aria-label="Secciones del trabajo">
        {[{ k: "resumen", l: "Resumen", href: `/trabajos/${j.id}` }, { k: "archivos", l: `Fotos y documentos${fileCount ? ` (${fileCount})` : ""}`, href: `/trabajos/${j.id}?tab=archivos` }].map((t) => (
          <Link key={t.k} href={t.href} scroll={false} aria-current={tab === t.k ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 -mb-px ${tab === t.k ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t.l}
          </Link>
        ))}
        {tab === "resumen" && [["#tareas", "Tareas"], ["#citas", "Citas"], ["#actividad", "Actividad"], ["#seguro", "Seguro"], ["#equipo", "Montos"]].map(([h, l]) => (
          <a key={h} href={h} className="whitespace-nowrap px-3 py-2.5 text-sm text-muted hover:text-ink lg:hidden">{l}</a>
        ))}
      </nav>

      {tab === "archivos" ? (
        <JobFilesTab jobId={j.id} me={profile.id} canDeleteAny={profile.role !== "vendedor"} />
      ) : (
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <section className="card p-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="h2">Estado</h2>
              <span className="muted">Etapa: {st.stageLabel} · desde {fmtDate(j.status_changed_at)}</span>
            </div>
            <StatusSelect action={setJobStatus.bind(null, j.id)} value={j.status} />
          </section>

          <section id="tareas" className="card p-4 scroll-mt-28">
            <h2 className="h2 mb-3">Tareas</h2>
            <TaskForm users={active} jobId={j.id} contactId={c.id} me={profile.id} />
            <div className="mt-3"><TaskList tasks={(tasks.data ?? []) as any[]} /></div>
          </section>

          <section id="citas" className="card p-4 scroll-mt-28">
            <h2 className="h2 mb-3">Citas</h2>
            {(appts.data ?? []).length > 0 && (
              <ul className="divide-y divide-line/70 mb-3">
                {appts.data!.map((a: any) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div>
                      <div className="font-semibold">{fmtDateTime(a.starts_at)} · {apptLabel(a.kind)}</div>
                      <div className="muted">{[a.title, a.assignee?.full_name, a.location].filter(Boolean).join(" · ")}</div>
                    </div>
                    <form action={deleteAppointment.bind(null, a.id, j.id)}>
                      <button className="text-gray-400 hover:text-red-600 text-sm px-1" aria-label="Borrar cita">✕</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="font-semibold text-brand cursor-pointer">+ Agendar cita</summary>
              <form action={createAppointment} className="grid sm:grid-cols-2 gap-3 mt-3">
                <input type="hidden" name="job_id" value={j.id} />
                <input type="hidden" name="contact_id" value={c.id} />
                <input type="hidden" name="location" value={addr.join(", ")} />
                <div>
                  <label className="label">Tipo</label>
                  <select className="input" name="kind" defaultValue="inspeccion">
                    {APPT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Título</label>
                  <input className="input" name="title" defaultValue={`${fullName(c)}`} required />
                </div>
                <div>
                  <label className="label">Fecha y hora</label>
                  <input className="input" name="starts_at" type="datetime-local" required />
                </div>
                <div>
                  <label className="label">Asignada a</label>
                  <select className="input" name="assigned_to" defaultValue={j.sales_rep_id ?? profile.id}>
                    {active.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
                <button className="btn-primary sm:col-span-2">Guardar cita</button>
              </form>
            </details>
          </section>

          <section id="actividad" className="card p-4 scroll-mt-28">
            <h2 className="h2 mb-3">Actividad</h2>
            <ActivityFeed action={addJobNote.bind(null, j.id, c.id)} items={(acts.data ?? []) as any[]} />
          </section>
        </div>

        <aside className="space-y-5">
          <JobReferences
            job={{ id: j.id, status: j.status, reference_authorized: !!j.reference_authorized, reference_authorized_at: j.reference_authorized_at ?? null, reference_note: j.reference_note ?? null }}
            canEdit={profile.role !== "vendedor" || j.sales_rep_id === profile.id || j.created_by === profile.id}
          />
          <section id="seguro" className="card p-4 scroll-mt-28">
            <h2 className="h2 mb-2">Seguro</h2>
            <KV k="Tipo" v={j.job_type === "retail" ? "Retail" : "Seguro"} />
            <KV k="Aseguradora" v={j.insurer} />
            <KV k="Póliza" v={j.policy_number} />
            <KV k="Claim" v={j.claim_number} />
            <KV k="Fecha de pérdida" v={fmtDate(j.date_of_loss)} />
            <KV k="Tormenta" v={fmtDate(j.storm_date)} />
            <KV k="Ajustador" v={j.adjuster_name} />
            {j.adjuster_phone && <KV k="Tel. ajustador" v={<a className="text-brand" href={telHref(j.adjuster_phone)}>{j.adjuster_phone}</a>} />}
            {j.adjuster_email && <KV k="Correo ajustador" v={j.adjuster_email} />}
          </section>
          <section id="equipo" className="card p-4 scroll-mt-28">
            <h2 className="h2 mb-2">Equipo y montos</h2>
            <KV k="Vendedor" v={(j as any).rep?.full_name} />
            <KV k="Project manager" v={(j as any).pm?.full_name} />
            <KV k="Territorio" v={(j as any).territory ? `${(j as any).territory.code} · ${(j as any).territory.name}` : null} />
            <KV k="Estimado" v={fmtMoney(j.estimate_amount)} />
            <KV k="Aprobado" v={fmtMoney(j.approved_amount)} />
            <KV k="Deducible" v={fmtMoney(j.deductible)} />
            {j.notes && <p className="text-sm whitespace-pre-wrap mt-3 text-gray-700">{j.notes}</p>}
          </section>
          <JobFinance jobId={j.id} users={active} />
          <details className="card p-4">
            <summary className="font-semibold cursor-pointer">Editar trabajo</summary>
            <form action={updateJob.bind(null, j.id)} className="space-y-4 mt-4">
              <JobFields j={j} users={active} territories={terr.data ?? []} />
              <button className="btn-primary w-full">Guardar cambios</button>
            </form>
            {profile.role === "administrador" && (
              <form action={deleteJob.bind(null, j.id)} className="mt-4 border-t pt-4">
                <button className="btn-ghost text-red-600 w-full">Eliminar trabajo</button>
              </form>
            )}
          </details>
        </aside>
      </div>
      )}
    </>
  );
}
