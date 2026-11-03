import Link from "next/link";
import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { STAGES, STATUSES, apptLabel, statusInfo, type StageKey } from "@/lib/constants";
import { firstName, fmtDate, fmtDateTime, fmtMoney, fmtTime, localToISO, todayTX } from "@/lib/format";
import { EmptyInline, ProgressBar, STAGE_TONE, Section, Stat, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";

// Estados (ya existentes) que cuentan como reclamo aprobado y como contrato firmado. No se mezclan.
const APPROVED = ["aprobado", "suplemento"];
const SIGNED = ["contrato_firmado", "materiales", "instalacion_agendada", "en_instalacion", "facturado", "pago_parcial", "completado"];
const stageOf = (s: string) => (STATUSES.find((x) => x.key === s)?.stage ?? "lead") as StageKey;

export default async function Dashboard() {
  const { supabase, profile } = await getSession();
  const staff = isStaff(profile);
  const today = todayTX();
  const start = localToISO(today + "T00:00")!;
  const in7 = new Date(new Date(start).getTime() + 7 * 24 * 3600 * 1000).toISOString();

  const [jobsRes, apptRes, tasksRes, actRes, streetsRes, users] = await Promise.all([
    supabase.from("jobs").select("id, number, name, status, sales_rep_id, approved_amount, status_changed_at, address, city"),
    supabase.from("appointments").select("id, title, kind, starts_at, location, job_id, assigned_to")
      .gte("starts_at", start).lt("starts_at", in7).order("starts_at").limit(30),
    supabase.from("tasks").select("id, title, due_at, job_id").eq("done", false).eq("assigned_to", profile.id)
      .order("due_at", { ascending: true, nullsFirst: false }).limit(6),
    supabase.from("activities").select("id, body, kind, created_at, job_id, author:profiles(full_name), job:jobs(name, number)")
      .order("created_at", { ascending: false }).limit(6),
    supabase.from("territory_streets").select("status, last_visit_at, name, territory:territories(id, code, name)"),
    listProfiles(),
  ]);

  const jobs = (jobsRes.data ?? []) as any[];
  const byStage = STAGES.map((s) => ({ ...s, n: jobs.filter((j) => stageOf(j.status) === s.key).length }));
  const n = (k: StageKey) => byStage.find((s) => s.key === k)?.n ?? 0;
  const activeJobs = jobs.filter((j) => !["perdido", "completado"].includes(stageOf(j.status)));
  const approvedSum = jobs.filter((j) => [...APPROVED, ...SIGNED].includes(j.status)).reduce((a, j) => a + Number(j.approved_amount ?? 0), 0);

  const appts = (apptRes.data ?? []) as any[];
  const mineAppts = (staff ? appts : appts.filter((a) => a.assigned_to === profile.id)).slice(0, 5);
  const todayCount = appts.filter((a) => new Date(a.starts_at).getTime() < new Date(start).getTime() + 86400000 && (staff || a.assigned_to === profile.id)).length;

  const streets = (streetsRes.data ?? []) as any[];
  const doneStreets = streets.filter((s) => s.status === "terminada").length;
  const progStreets = streets.filter((s) => s.status === "en_progreso").length;
  const last = streets.filter((s) => s.last_visit_at).sort((a, b) => b.last_visit_at.localeCompare(a.last_visit_at))[0];

  // Trabajos activos sin cambio de estado en 14 días o más
  const stale = activeJobs.filter((j) => j.status_changed_at && Date.now() - new Date(j.status_changed_at).getTime() > 14 * 86400000)
    .sort((a, b) => a.status_changed_at.localeCompare(b.status_changed_at)).slice(0, 5);

  // Ranking del equipo (solo staff): aprobados y firmados por vendedor
  const reps = staff ? users.filter((u) => u.active).map((u) => {
    const mine = jobs.filter((j) => j.sales_rep_id === u.id);
    return {
      id: u.id, name: u.full_name,
      leads: mine.filter((j) => stageOf(j.status) === "lead").length,
      approved: mine.filter((j) => [...APPROVED, ...SIGNED].includes(j.status)).length,
      signed: mine.filter((j) => SIGNED.includes(j.status)).length,
      total: mine.length,
    };
  }).filter((r) => r.total > 0).sort((a, b) => b.signed - a.signed || b.approved - a.approved || b.total - a.total).slice(0, 5) : [];

  const name = firstName(profile.full_name);
  const dateLabel = new Date(today + "T12:00:00Z").toLocaleDateString("es-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const maxStage = Math.max(1, ...byStage.map((s) => s.n));
  const now = Date.now();

  return (
    <div className="space-y-5">
      {/* Saludo */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow capitalize">{dateLabel}</p>
          <h1 className="h1 mt-0.5">{name ? `Hola, ${name}` : "Hola"}</h1>
          <p className="muted mt-0.5">
            {todayCount ? `${todayCount} cita${todayCount === 1 ? "" : "s"} hoy` : "Sin citas hoy"} · {(tasksRes.data ?? []).length ? `${(tasksRes.data ?? []).length} tarea(s) pendiente(s)` : "sin tareas pendientes"}
          </p>
        </div>
        <Link href="/trabajos/nuevo" className="btn-primary hidden sm:inline-flex"><Icon name="plus" className="w-4 h-4" />Nuevo lead</Link>
      </div>

      {/* KPIs: 2 visibles en móvil, el resto expandible */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Leads activos" value={n("lead")} icon="inbox" href="/trabajos?etapa=lead" tone="dark" />
        <Stat label="Vendidos" value={n("vendido")} icon="check" href="/trabajos?etapa=vendido" tone="brand" />
        <div className="hidden lg:block"><Stat label="Seguro / Estimado" value={n("seguro")} icon="shield" href="/trabajos?etapa=seguro" /></div>
        <div className="hidden lg:block"><Stat label="En producción" value={n("produccion")} icon="hammer" href="/trabajos?etapa=produccion" /></div>
        {staff
          ? <div className="hidden lg:block"><Stat label="Monto aprobado" value={fmtMoney(approvedSum)} icon="dollar" hint="Trabajos aprobados o firmados" /></div>
          : <div className="hidden lg:block"><Stat label="Cobro" value={n("cobro")} icon="dollar" href="/trabajos?etapa=cobro" /></div>}
      </div>
      <details className="lg:hidden -mt-2 group">
        <summary className="list-none cursor-pointer text-sm font-medium text-muted flex items-center gap-1">
          <Icon name="chevronDown" className="w-4 h-4 transition group-open:rotate-180" />Más indicadores
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Stat label="Seguro / Estimado" value={n("seguro")} icon="shield" href="/trabajos?etapa=seguro" />
          <Stat label="En producción" value={n("produccion")} icon="hammer" href="/trabajos?etapa=produccion" />
          <Stat label="Cobro" value={n("cobro")} icon="dollar" href="/trabajos?etapa=cobro" />
          {staff && <Stat label="Monto aprobado" value={fmtMoney(approvedSum)} icon="dollar" hint="Aprobados o firmados" />}
        </div>
      </details>

      {/* Acciones rápidas (móvil) */}
      <div className="lg:hidden grid grid-cols-4 gap-2">
        {[
          { href: "/trabajos/nuevo", icon: "plus", l: "Lead" },
          { href: "/calendario?nueva=inspeccion", icon: "calendar", l: "Inspección" },
          { href: "/tareas?nueva=1", icon: "tasks", l: "Tarea" },
          { href: last?.territory?.id ? `/territorios/${last.territory.id}` : "/territorios", icon: "door", l: "Visita" },
        ].map((a) => (
          <Link key={a.l} href={a.href} className="card flex flex-col items-center gap-1 py-3 text-xs font-medium active:bg-canvas">
            <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center"><Icon name={a.icon} className="w-5 h-5" /></span>{a.l}
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Pipeline */}
        <Section title="Pipeline" action={<Link href="/trabajos" className="link">Ver trabajos</Link>} className="lg:col-span-2">
          <ul className="space-y-2.5">
            {byStage.filter((s) => s.key !== "perdido").map((s) => (
              <li key={s.key}>
                <Link href={`/trabajos?etapa=${s.key}`} className="grid grid-cols-[120px_1fr_36px] sm:grid-cols-[150px_1fr_40px] items-center gap-3 text-sm group">
                  <span className="flex items-center gap-2 text-ink/80 group-hover:text-ink"><span className={`w-2 h-2 rounded-full ${STAGE_TONE[s.key].dot}`} />{s.label}</span>
                  <span className="h-2.5 rounded-full bg-canvas overflow-hidden"><span className={`block h-full rounded-full ${STAGE_TONE[s.key].bar}`} style={{ width: `${(100 * s.n) / maxStage}%` }} /></span>
                  <span className="text-right font-semibold tnum">{s.n}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-3">{n("perdido")} perdido(s) no se muestran.</p>
        </Section>

        {/* Ranking o mis citas */}
        {staff ? (
          <Section title="Equipo" action={<Link href="/tormentas" className="link">Rendimiento</Link>}>
            {reps.length === 0 ? <EmptyInline>Sin trabajos asignados a vendedores.</EmptyInline> : (
              <ol className="space-y-2">
                {reps.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${i === 0 ? "bg-brand text-white" : "bg-canvas text-ink/70"}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    <span className="text-xs text-muted tnum" title="Firmados · aprobados · leads">{r.signed} firm. · {r.approved} aprob. · {r.leads} leads</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted mt-3">Firmado = contrato firmado o posterior. Aprobado = reclamo aprobado o posterior.</p>
          </Section>
        ) : (
          <ApptCard appts={mineAppts} />
        )}

        {staff && <ApptCard appts={mineAppts} />}

        {/* Mis tareas */}
        <Section title="Mis tareas" action={<Link href="/tareas" className="link">Ver todas</Link>}>
          {(tasksRes.data ?? []).length === 0 ? <EmptyInline action={<Link href="/tareas?nueva=1" className="link">+ Tarea</Link>}>Sin tareas pendientes.</EmptyInline> : (
            <ul className="divide-y divide-line/70">
              {tasksRes.data!.map((t) => {
                const late = t.due_at && new Date(t.due_at).getTime() < now;
                return (
                  <li key={t.id} className="py-2.5 flex items-start gap-2.5">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${late ? "bg-red-600" : "bg-line"}`} aria-hidden />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{t.job_id ? <Link href={`/trabajos/${t.job_id}`}>{t.title}</Link> : t.title}</div>
                      {t.due_at && <div className={`text-xs ${late ? "text-red-600 font-medium" : "text-muted"}`}>{late ? "Vencida · " : ""}{fmtDateTime(t.due_at)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Door-to-door */}
        <Section title="Door-to-door" action={<Link href="/territorios" className="link">Calles</Link>}>
          {streets.length === 0 ? <EmptyInline>No hay calles cargadas.</EmptyInline> : (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-semibold tnum">{doneStreets}<span className="text-base text-muted font-normal"> / {streets.length}</span></span>
                <span className="text-xs text-muted">{progStreets} en progreso</span>
              </div>
              <ProgressBar value={doneStreets} max={streets.length} label="Calles terminadas" />
              {last ? (
                <Link href={`/territorios/${last.territory?.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-2.5 hover:bg-line/50">
                  <span className="min-w-0">
                    <span className="block text-xs text-muted">Última calle trabajada · {fmtDate(last.last_visit_at)}</span>
                    <span className="block text-sm font-medium truncate">{last.name} · Zona {last.territory?.code}</span>
                  </span>
                  <span className="btn-dark btn-sm shrink-0">Continuar</span>
                </Link>
              ) : <p className="text-xs text-muted">Todavía no hay visitas registradas.</p>}
            </div>
          )}
        </Section>

        {/* Requieren atención */}
        <Section title="Requieren atención" className="lg:col-span-2" action={<span className="text-xs text-muted">Sin cambio de estado en 14+ días</span>}>
          {stale.length === 0 ? <EmptyInline>Todo al día.</EmptyInline> : (
            <ul className="divide-y divide-line/70">
              {stale.map((j) => (
                <li key={j.id}>
                  <Link href={`/trabajos/${j.id}`} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">#{j.number} {j.name}</span>
                      <span className="block text-xs text-muted truncate">{[j.address, j.city].filter(Boolean).join(", ") || statusInfo(j.status).stageLabel} · desde {fmtDate(j.status_changed_at)}</span>
                    </span>
                    <StatusBadge status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Actividad */}
        <Section title="Actividad reciente">
          {(actRes.data ?? []).length === 0 ? <EmptyInline>Todavía no hay actividad.</EmptyInline> : (
            <ul className="space-y-3">
              {actRes.data!.map((a: any) => (
                <li key={a.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium truncate">{a.job ? <Link href={`/trabajos/${a.job_id}`}>#{a.job.number} {a.job.name}</Link> : "General"}</span>
                    <span className="text-xs text-muted shrink-0">{fmtDateTime(a.created_at)}</span>
                  </div>
                  <div className="text-muted line-clamp-2">{a.author?.full_name ? `${a.author.full_name}: ` : ""}{renderAct(a)}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function renderAct(a: { kind: string; body: string }) {
  if (a.kind === "cambio_estado") {
    const [x, y] = a.body.split(" → ");
    return `${statusInfo(x).label} → ${statusInfo(y ?? "").label}`;
  }
  return a.body;
}

function ApptCard({ appts }: { appts: any[] }) {
  return (
    <Section title="Próximas citas" action={<Link href="/calendario" className="link">Agenda</Link>}>
      {appts.length === 0 ? <EmptyInline action={<Link href="/calendario?nueva=inspeccion" className="link">+ Cita</Link>}>Sin citas en los próximos 7 días.</EmptyInline> : (
        <ul className="divide-y divide-line/70">
          {appts.map((a) => (
            <li key={a.id} className="py-2.5 flex gap-3">
              <div className="w-14 shrink-0 text-center">
                <div className="text-[11px] uppercase text-muted">{new Date(a.starts_at).toLocaleDateString("es-US", { weekday: "short", timeZone: "America/Chicago" })}</div>
                <div className="text-sm font-semibold tnum">{fmtTime(a.starts_at)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{a.job_id ? <Link href={`/trabajos/${a.job_id}`}>{a.title}</Link> : a.title}</div>
                <div className="text-xs text-muted truncate">{apptLabel(a.kind)}{a.location ? ` · ${a.location}` : ""}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
