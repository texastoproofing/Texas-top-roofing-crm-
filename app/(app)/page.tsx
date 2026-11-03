import Link from "next/link";
import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { STAGES, STATUSES, apptLabel, statusInfo, type StageKey } from "@/lib/constants";
import { firstName, fmtDate, fmtDateTime, fmtMoney, fmtTime, localToISO, todayTX } from "@/lib/format";
import { Avatar, EmptyInline, ProgressBar, Section, StatusBadge } from "@/components/ui";
import { QuickButtons } from "@/components/Nav";
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
  const now = Date.now();
  const dayEnd = new Date(start).getTime() + 86400000;
  const todays = appts.filter((a) => new Date(a.starts_at).getTime() < dayEnd && (staff || a.assigned_to === profile.id));
  const upcoming = todays.length ? todays : mineAppts;
  const pipe = byStage.filter((s) => s.key !== "perdido" && s.n > 0);
  const pipeTotal = pipe.reduce((a, s) => a + s.n, 0);
  const repsMoney = staff ? users.filter((u) => u.active).map((u) => {
    const mine = jobs.filter((j) => j.sales_rep_id === u.id && [...APPROVED, ...SIGNED].includes(j.status));
    return { id: u.id, money: mine.reduce((a, j) => a + Number(j.approved_amount ?? 0), 0) };
  }) : [];
  const moneyOf = (id: string) => repsMoney.find((r) => r.id === id)?.money ?? 0;
  const topMoney = Math.max(1, ...reps.map((r) => moneyOf(r.id)), ...reps.map((r) => r.signed));

  const KPI = [
    { k: "lead" as StageKey, label: "Leads", icon: "contacts", tile: "bg-brand-soft text-brand" },
    { k: "seguro" as StageKey, label: "Seguro / Estimado", icon: "file", tile: "bg-sky-50 text-sky-600" },
    { k: "vendido" as StageKey, label: "Vendidos", icon: "check", tile: "bg-green-50 text-green-600" },
    { k: "produccion" as StageKey, label: "Producción", icon: "hammer", tile: "bg-amber-50 text-amber-600" },
  ];

  return (
    <div className="space-y-5">
      {/* Saludo */}
      <div>
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight">{name ? `¡Hola, ${name}!` : "¡Hola!"} <span aria-hidden>👋</span></h1>
        <p className="muted mt-0.5"><span className="hidden sm:inline">Resumen general de Texas Top Roofing · </span><span className="capitalize">{new Date(today + "T12:00:00Z").toLocaleDateString("es-US", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</span></p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {KPI.map((x) => (
          <Link key={x.k} href={`/trabajos?etapa=${x.k}`} className="card p-3 lg:p-5 flex items-center lg:items-start gap-3 lg:gap-4 hover:shadow-pop transition">
            <span className={`w-10 h-10 lg:w-14 lg:h-14 shrink-0 rounded-xl flex items-center justify-center ${x.tile}`}><Icon name={x.icon} className="w-5 h-5 lg:w-7 lg:h-7" /></span>
            <span className="min-w-0">
              <span className="hidden lg:block text-sm font-medium text-ink/80">{x.label}</span>
              <span className="block text-xl lg:text-3xl font-bold tnum leading-tight">{n(x.k)}</span>
              <span className="lg:hidden block text-xs text-muted truncate">{x.label}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* Acciones rápidas (móvil) */}
      <div className="lg:hidden">
        <h2 className="h2 mb-2">Acciones rápidas</h2>
        <QuickButtons />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Pipeline (dona) */}
        <Section title="Pipeline de ventas" action={<Link href="/trabajos" className="link">Ver pipeline →</Link>} className="order-5 lg:order-none">
          {pipeTotal === 0 ? <EmptyInline>No hay trabajos todavía.</EmptyInline> : (
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <Donut parts={pipe.map((s) => ({ v: s.n, color: STAGE_HEX[s.key] }))} total={pipeTotal} label="Trabajos" />
              <ul className="w-full space-y-2">
                {pipe.map((s) => (
                  <li key={s.key}>
                    <Link href={`/trabajos?etapa=${s.key}`} className="flex items-center gap-2 text-sm hover:text-ink">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STAGE_HEX[s.key] }} />
                      <span className="flex-1 text-ink/80">{s.label}</span>
                      <span className="font-semibold tnum">{s.n}</span>
                      <span className="w-12 text-right text-muted tnum">({Math.round((100 * s.n) / pipeTotal)}%)</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {/* Rendimiento del equipo (solo staff) */}
        {staff && (
          <Section title="Rendimiento del equipo" action={<Link href="/tormentas" className="link">Ver ranking →</Link>} className="order-6 lg:order-none">
            {reps.length === 0 ? <EmptyInline>Sin trabajos asignados a vendedores.</EmptyInline> : (
              <ol className="divide-y divide-line/70">
                {reps.map((r, i) => {
                  const m = moneyOf(r.id);
                  const val = repsMoney.some((x) => x.money > 0) ? m : r.signed;
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-2.5">
                      <span className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${["bg-amber-100 text-amber-700", "bg-gray-100 text-gray-600", "bg-orange-100 text-orange-700"][i] ?? "bg-canvas text-muted"}`}>{i + 1}</span>
                      <Avatar name={r.name} className="w-9 h-9 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate">{r.name}</span>
                        <span className="block text-xs text-muted">{r.signed} firmado(s) · {r.approved} aprobado(s){m > 0 ? ` · ${fmtMoney(m)}` : ""}</span>
                      </span>
                      <span className="hidden sm:block w-28"><ProgressBar value={val} max={topMoney} label={`Rendimiento de ${r.name}`} /></span>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="text-xs text-muted mt-2">Firmado = contrato firmado o posterior. Aprobado = reclamo aprobado o posterior. Monto = aprobado en esos trabajos.</p>
          </Section>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Citas de hoy */}
        <Section title={<>{todays.length ? "Citas de hoy" : "Próximas citas"} <span className="text-muted font-normal">({upcoming.length})</span></>} action={<Link href="/calendario" className="link">Ver agenda →</Link>} className="order-1 lg:order-none">
          {upcoming.length === 0 ? <EmptyInline action={<Link href="/calendario?nueva=inspeccion" className="link">+ Cita</Link>}>Sin citas en los próximos 7 días.</EmptyInline> : (
            <ul className="space-y-2">
              {upcoming.map((a) => {
                const tone = APPT_TONE[a.kind] ?? APPT_TONE.otra;
                return (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line p-2 pl-0 overflow-hidden">
                    <span className={`self-stretch w-1 rounded-r ${tone.bar}`} aria-hidden />
                    <span className="shrink-0 rounded-md bg-canvas px-2 py-1 text-xs font-semibold tnum">{todays.length ? fmtTime(a.starts_at) : `${new Date(a.starts_at).toLocaleDateString("es-US", { weekday: "short", timeZone: "America/Chicago" })} ${fmtTime(a.starts_at)}`}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate">{a.job_id ? <Link href={`/trabajos/${a.job_id}`}>{a.title}</Link> : a.title}</span>
                      {a.location && <span className="block text-xs text-muted truncate">{a.location}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chip}`}>{apptLabel(a.kind)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Door-to-door */}
        <Section title="Door-to-Door (Calles)" action={<Link href="/territorios" className="link">Ver calles →</Link>} className="order-2 lg:order-none">
          {streets.length === 0 ? <EmptyInline>No hay calles cargadas.</EmptyInline> : (
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-ink/80">{doneStreets} de {streets.length} calles terminadas</span>
                  <span className="font-semibold tnum">{Math.round((100 * doneStreets) / streets.length)}%</span>
                </div>
                <ProgressBar value={doneStreets} max={streets.length} label="Calles terminadas" />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-line py-2.5"><Icon name="pin" className="w-5 h-5 mx-auto text-brand" /><div className="text-lg font-bold tnum">{streets.length}</div><div className="text-[11px] text-muted">Calles</div></div>
                <div className="rounded-lg border border-line py-2.5"><Icon name="check" className="w-5 h-5 mx-auto text-green-600" /><div className="text-lg font-bold tnum">{doneStreets}</div><div className="text-[11px] text-muted">Terminadas</div></div>
                <div className="rounded-lg border border-line py-2.5"><Icon name="clock" className="w-5 h-5 mx-auto text-amber-500" /><div className="text-lg font-bold tnum">{streets.length - doneStreets}</div><div className="text-[11px] text-muted">Pendientes</div></div>
              </div>
              <Link href={last?.territory?.id ? `/territorios/${last.territory.id}` : "/territorios"} className="btn-primary w-full">
                <Icon name="arrowRight" className="w-4 h-4" />{last ? "Continuar recorrido" : "Empezar recorrido"}
              </Link>
              {last && <p className="text-xs text-muted text-center -mt-1">Última: {last.name} · Zona {last.territory?.code} · {fmtDate(last.last_visit_at)}{progStreets ? ` · ${progStreets} en progreso` : ""}</p>}
            </div>
          )}
        </Section>

        {/* Actividad */}
        <Section title="Actividad reciente" className="order-7 lg:order-none">
          {(actRes.data ?? []).length === 0 ? <EmptyInline>Todavía no hay actividad.</EmptyInline> : (
            <ul className="space-y-3">
              {actRes.data!.map((a: any) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${ACT_TONE[a.kind] ?? "bg-canvas text-muted"}`}><Icon name={ACT_ICON[a.kind] ?? "activity"} className="w-4 h-4" /></span>
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{a.job ? <Link href={`/trabajos/${a.job_id}`}>{a.job.name}</Link> : "General"}</span>
                    <span className="block text-xs text-muted line-clamp-2">{renderAct(a)}</span>
                    <span className="block text-[11px] text-muted/80">{a.author?.full_name ? `${a.author.full_name} · ` : ""}{fmtDateTime(a.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Mis tareas */}
        <Section title="Mis tareas" action={<Link href="/tareas" className="link">Ver todas →</Link>} className="order-3 lg:order-none">
          {(tasksRes.data ?? []).length === 0 ? <EmptyInline action={<Link href="/tareas?nueva=1" className="link">+ Tarea</Link>}>Sin tareas pendientes.</EmptyInline> : (
            <ul className="divide-y divide-line/70">
              {tasksRes.data!.map((t) => {
                const late = t.due_at && new Date(t.due_at).getTime() < now;
                return (
                  <li key={t.id} className="py-2.5 flex items-start gap-2.5">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${late ? "bg-red-600" : "bg-line"}`} aria-hidden />
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

        {/* Requieren atención */}
        <Section title="Requieren atención" className="lg:col-span-2 order-4 lg:order-none" action={<span className="text-xs text-muted">Sin cambio en 14+ días</span>}>
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
      </div>
    </div>
  );
}

const STAGE_HEX: Record<StageKey, string> = {
  lead: "#0EA5E9", seguro: "#F59E0B", vendido: "#16A34A", produccion: "#8B5CF6", cobro: "#F97316", completado: "#15803D", perdido: "#9CA3AF",
};
const APPT_TONE: Record<string, { bar: string; chip: string }> = {
  inspeccion: { bar: "bg-brand", chip: "bg-brand-soft text-brand" },
  ajustador: { bar: "bg-sky-500", chip: "bg-sky-50 text-sky-700" },
  firma: { bar: "bg-green-600", chip: "bg-green-50 text-green-700" },
  instalacion: { bar: "bg-violet-500", chip: "bg-violet-50 text-violet-700" },
  seguimiento: { bar: "bg-amber-500", chip: "bg-amber-50 text-amber-700" },
  otra: { bar: "bg-gray-400", chip: "bg-canvas text-ink/70" },
};
const ACT_ICON: Record<string, string> = { nota: "note", llamada: "phone", visita: "door", cambio_estado: "check", sistema: "activity" };
const ACT_TONE: Record<string, string> = {
  nota: "bg-sky-50 text-sky-600", llamada: "bg-amber-50 text-amber-600", visita: "bg-violet-50 text-violet-600",
  cambio_estado: "bg-green-50 text-green-600", sistema: "bg-canvas text-muted",
};

// Dona SVG sin librerías
function Donut({ parts, total, label }: { parts: { v: number; color: string }[]; total: number; label: string }) {
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg viewBox="0 0 140 140" className="w-40 h-40 shrink-0" role="img" aria-label={`${total} ${label}`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#F6F7F9" strokeWidth="22" />
      {parts.map((p, i) => {
        const len = (p.v / total) * c;
        const el = <circle key={i} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="22" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />;
        off += len;
        return el;
      })}
      <text x="70" y="68" textAnchor="middle" className="fill-ink" style={{ font: "700 28px var(--font-inter), sans-serif" }}>{total}</text>
      <text x="70" y="88" textAnchor="middle" className="fill-muted" style={{ font: "500 12px var(--font-inter), sans-serif" }}>{label}</text>
    </svg>
  );
}

function renderAct(a: { kind: string; body: string }) {
  if (a.kind === "cambio_estado") {
    const [x, y] = a.body.split(" → ");
    return `${statusInfo(x).label} → ${statusInfo(y ?? "").label}`;
  }
  return a.body;
}
