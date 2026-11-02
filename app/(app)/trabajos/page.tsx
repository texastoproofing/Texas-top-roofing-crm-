import Link from "next/link";
import { getSession } from "@/lib/auth";
import { STAGES, STATUSES } from "@/lib/constants";
import { fmtDate, fullName } from "@/lib/format";
import { Empty, PageHeader, StatusBadge } from "@/components/ui";
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
    .select("id, number, name, status, insurer, claim_number, address, city, zip, date_of_loss, status_changed_at, contact:contacts(first_name, last_name, phone), rep:profiles!jobs_sales_rep_id_fkey(full_name)")
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

  return (
    <>
      <PageHeader title="Trabajos" sub={`${jobs.length} trabajo(s)`}
        action={<Link href="/trabajos/nuevo" className="btn-primary">+ Nuevo</Link>} />

      <form className="mb-3 flex gap-2">
        <input type="hidden" name="etapa" value={stage} />
        <input type="hidden" name="vista" value={view} />
        {mine && <input type="hidden" name="mios" value="1" />}
        <input className="input" name="q" defaultValue={q} placeholder="Buscar nombre, dirección, claim, aseguradora" type="search" />
      </form>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4">
        <Link href={params({ etapa: "" })} className={`chip py-1.5 ${!stage ? "bg-gray-900 text-white border-gray-900" : "bg-white"}`}>Activos</Link>
        {STAGES.map((s) => (
          <Link key={s.key} href={params({ etapa: s.key })} className={`chip py-1.5 ${stage === s.key ? "bg-gray-900 text-white border-gray-900" : "bg-white"}`}>{s.label}</Link>
        ))}
        <span className="w-px bg-gray-200 mx-1" />
        <Link href={params({ mios: mine ? "" : "1" })} className={`chip py-1.5 ${mine ? "bg-brand text-white border-brand" : "bg-white"}`}>Solo míos</Link>
        <Link href={params({ vista: view === "lista" ? "tablero" : "lista" })} className="chip py-1.5 bg-white">{view === "lista" ? "Ver tablero" : "Ver lista"}</Link>
      </div>

      {jobs.length === 0 ? <Empty>No hay trabajos aquí todavía.</Empty> : view === "lista" ? (
        <ul className="card divide-y divide-gray-100">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/trabajos/${j.id}`} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">#{j.number} {j.name}</div>
                  <div className="muted truncate">{[j.address, j.city].filter(Boolean).join(", ")}</div>
                  <div className="text-xs text-gray-400 truncate">{[j.insurer, j.rep?.full_name].filter(Boolean).join(" · ")}</div>
                </div>
                <StatusBadge status={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 snap-x">
          {statuses.map((s) => {
            const col = jobs.filter((j) => j.status === s.key);
            return (
              <section key={s.key} className="snap-start shrink-0 w-[82vw] sm:w-72 bg-gray-100 rounded-xl p-2 flex flex-col max-h-[75vh]">
                <h2 className="flex justify-between items-center px-1.5 py-1 text-sm font-bold">
                  <span>{s.label}</span><span className="text-gray-500 tabular-nums">{col.length}</span>
                </h2>
                <div className="space-y-2 overflow-y-auto">
                  {col.map((j) => (
                    <article key={j.id} className="bg-white rounded-lg border border-gray-200 p-3 space-y-2">
                      <Link href={`/trabajos/${j.id}`} className="block">
                        <div className="font-semibold leading-tight">{fullName(j.contact) !== "Sin nombre" ? fullName(j.contact) : j.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">#{j.number}{j.insurer ? ` · ${j.insurer}` : ""}</div>
                        {j.address && <div className="text-xs text-gray-500 truncate">{j.address}{j.city ? `, ${j.city}` : ""}</div>}
                        {j.date_of_loss && <div className="text-xs text-gray-500">DOL {fmtDate(j.date_of_loss)}</div>}
                      </Link>
                      <StatusSelect compact action={setJobStatus.bind(null, j.id)} value={j.status} />
                    </article>
                  ))}
                  {col.length === 0 && <p className="text-xs text-gray-400 px-1.5 py-2">Vacío</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
