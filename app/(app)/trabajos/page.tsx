import Link from "next/link";
import { getSession } from "@/lib/auth";
import { STAGES, STATUSES } from "@/lib/constants";
import { fmtDate, fullName } from "@/lib/format";
import { Empty, PageHeader, STAGE_TONE, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { StatusSelect } from "@/components/StatusSelect";
import { setJobStatus } from "./actions";

type Search = { etapa?: string; vista?: string; q?: string; mios?: string };

export default async function JobsPage({ searchParams }: { searchParams: Search }) {
  const { supabase, profile } = await getSession();
  const stage = searchParams.etapa ?? "";
  const view = searchParams.vista === "lista" ? "lista" : "tablero";
  const q = (searchParams.q ?? "").trim();
  const mine = searchParams.mios === "1";

  let query = supabase.from("jobs")
    .select("id, number, name, status, insurer, claim_number, address, city, zip, date_of_loss, status_changed_at, approved_amount, estimate_amount, contact:contacts(first_name, last_name, phone), rep:profiles!jobs_sales_rep_id_fkey(full_name)")
    .order("status_changed_at", { ascending: false }).limit(500);
  if (stage) query = query.in("status", STATUSES.filter((s) => s.stage === stage).map((s) => s.key));
  if (mine) query = query.eq("sales_rep_id", profile.id);
  if (q) {
    const s = q.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${s}%,address.ilike.%${s}%,claim_number.ilike.%${s}%,insurer.ilike.%${s}%,zip.ilike.%${s}%`);
  }
  const { data } = await query;
  const jobs = (data ?? []) as any[];

  const params = (p: Partial<Search>) => {
    const u = new URLSearchParams();
    const merged = { etapa: stage, vista: view, q, mios: mine ? "1" : "", ...p };
    Object.entries(merged).forEach(([k, v]) => v && u.set(k, v));
    return "/trabajos?" + u.toString();
  };

  const statuses = STATUSES.filter((s) => !stage || s.stage === stage)
    .filter((s) => stage || (s.stage !== "perdido" && s.stage !== "completado"));

  const money = (n: any) => (n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
  const client = (j: any) => (fullName(j.contact) !== "Sin nombre" ? fullName(j.contact) : j.name);

  return (
    <>
      <PageHeader title="Trabajos" sub={`${jobs.length} trabajo(s)${stage ? ` · ${STAGES.find((x) => x.key === stage)?.label}` : " activos"}`}
        action={<Link href="/trabajos/nuevo" className="btn-primary"><Icon name="plus" className="w-4 h-4" /><span className="hidden sm:inline">Nuevo lead</span></Link>} />

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <form className="relative flex-1">
          <input type="hidden" name="etapa" value={stage} />
          <input type="hidden" name="vista" value={view} />
          {mine && <input type="hidden" name="mios" value="1" />}
          <Icon name="search" className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="input pl-9" name="q" defaultValue={q} placeholder="Buscar nombre, dirección, claim, aseguradora o ZIP" type="search" aria-label="Buscar trabajos" />
        </form>
        <div className="flex gap-2">
          <Link href={params({ mios: mine ? "" : "1" })} aria-pressed={mine}
            className={`btn btn-sm min-h-[44px] border ${mine ? "bg-night text-white border-night" : "bg-white border-line text-ink"}`}>Solo míos</Link>
          <div className="seg">
            <Link href={params({ vista: "tablero" })} aria-current={view === "tablero" ? "page" : undefined}>Tablero</Link>
            <Link href={params({ vista: "lista" })} aria-current={view === "lista" ? "page" : undefined}>Lista</Link>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-4 px-4 lg:mx-0 lg:px-0" role="tablist" aria-label="Etapas">
        <Link href={params({ etapa: "" })} aria-current={!stage ? "page" : undefined}
          className={`chip py-1.5 px-3 ${!stage ? "bg-night text-white border-night" : "bg-white border-line text-ink/80"}`}>Activos</Link>
        {STAGES.map((s) => (
          <Link key={s.key} href={params({ etapa: s.key })} aria-current={stage === s.key ? "page" : undefined}
            className={`chip py-1.5 px-3 gap-1.5 ${stage === s.key ? "bg-night text-white border-night" : "bg-white border-line text-ink/80"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${STAGE_TONE[s.key].dot}`} />{s.label}
          </Link>
        ))}
      </div>

      {jobs.length === 0 ? <Empty icon="jobs" action={<Link href="/trabajos/nuevo" className="btn-primary btn-sm">Nuevo lead</Link>}>No hay trabajos aquí todavía.</Empty> : view === "lista" ? (
        <>
          {/* Escritorio: tabla */}
          <div className="hidden md:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Trabajo</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium">Vendedor</th>
                  <th className="px-4 py-2.5 font-medium">Aseguradora</th>
                  <th className="px-4 py-2.5 font-medium text-right">Aprobado</th>
                  <th className="px-4 py-2.5 font-medium">Último cambio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-2.5 max-w-[320px]">
                      <Link href={`/trabajos/${j.id}`} className="block">
                        <span className="block font-medium truncate">{client(j)}</span>
                        <span className="block text-xs text-muted truncate">#{j.number} · {[j.address, j.city].filter(Boolean).join(", ") || j.name}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5"><StatusBadge status={j.status} /></td>
                    <td className="px-4 py-2.5 text-ink/80">{j.rep?.full_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink/80">{j.insurer ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tnum">{money(j.approved_amount)}</td>
                    <td className="px-4 py-2.5 text-muted">{fmtDate(j.status_changed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Móvil: tarjetas */}
          <ul className="md:hidden space-y-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/trabajos/${j.id}`} className="card flex items-start gap-3 p-3 active:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{client(j)}</span>
                      <span className="text-xs text-muted shrink-0">#{j.number}</span>
                    </div>
                    <div className="text-xs text-muted truncate">{[j.address, j.city].filter(Boolean).join(", ") || j.name}</div>
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                      <StatusBadge status={j.status} />
                      {j.insurer && <span className="text-xs text-muted">{j.insurer}</span>}
                    </div>
                  </div>
                  <Icon name="chevronRight" className="w-4 h-4 text-muted mt-1" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 lg:mx-0 lg:px-0 snap-x">
          {statuses.map((s) => {
            const col = jobs.filter((j) => j.status === s.key);
            const tone = STAGE_TONE[s.stage];
            return (
              <section key={s.key} className="snap-start shrink-0 w-[82vw] sm:w-72 rounded-xl bg-white/60 border border-line p-2 flex flex-col max-h-[72vh]">
                <h2 className="flex justify-between items-center px-1.5 py-1.5 text-sm font-semibold">
                  <span className="flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${tone.dot}`} />{s.label}</span>
                  <span className="text-xs text-muted tnum rounded-full bg-canvas px-2 py-0.5">{col.length}</span>
                </h2>
                <div className="space-y-2 overflow-y-auto">
                  {col.map((j) => (
                    <article key={j.id} className="bg-white rounded-lg border border-line shadow-card p-3 space-y-2">
                      <Link href={`/trabajos/${j.id}`} className="block">
                        <div className="text-sm font-medium leading-tight">{client(j)}</div>
                        <div className="text-xs text-muted mt-0.5">#{j.number}{j.insurer ? ` · ${j.insurer}` : ""}</div>
                        {j.address && <div className="text-xs text-muted truncate">{j.address}{j.city ? `, ${j.city}` : ""}</div>}
                        {j.date_of_loss && <div className="text-xs text-muted">DOL {fmtDate(j.date_of_loss)}</div>}
                      </Link>
                      <StatusSelect compact action={setJobStatus.bind(null, j.id)} value={j.status} />
                    </article>
                  ))}
                  {col.length === 0 && <p className="text-xs text-muted px-1.5 py-2">Vacío</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
