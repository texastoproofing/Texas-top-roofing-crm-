import Link from "next/link";
import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { TaskForm, TaskList } from "@/components/TaskList";

export default async function TasksPage({ searchParams }: { searchParams: { ver?: string; nueva?: string } }) {
  const { supabase, profile } = await getSession();
  const ver = searchParams.ver ?? "mias";
  let q = supabase.from("tasks")
    .select("id, title, description, due_at, done, job_id, assignee:profiles!tasks_assigned_to_fkey(full_name), job:jobs(number, name)")
    .order("due_at", { ascending: true, nullsFirst: false }).limit(300);
  if (ver === "hechas") q = q.eq("done", true).eq("assigned_to", profile.id);
  else if (ver === "todas" && isStaff(profile)) q = q.eq("done", false);
  else q = q.eq("done", false).eq("assigned_to", profile.id);
  const [{ data }, users] = await Promise.all([q, listProfiles()]);

  const tabs = [
    { k: "mias", l: "Mis pendientes" },
    ...(isStaff(profile) ? [{ k: "todas", l: "Todo el equipo" }] : []),
    { k: "hechas", l: "Hechas" },
  ];

  return (
    <>
      <PageHeader title="Tareas" sub={`${(data ?? []).length} ${ver === "hechas" ? "hechas" : "pendientes"}`} />
      <div className="seg mb-4 max-w-full overflow-x-auto">
        {tabs.map((t) => (
          <Link key={t.k} href={`/tareas?ver=${t.k}`} aria-current={ver === t.k ? "page" : undefined}>{t.l}</Link>
        ))}
      </div>
      <section className="card p-4 mb-4">
        <TaskForm users={users.filter((u) => u.active)} me={profile.id} autoFocus={!!searchParams.nueva} />
      </section>
      {ver !== "hechas" && (() => {
        const all = (data ?? []) as any[];
        const now = Date.now();
        const late = all.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
        const rest = all.filter((t) => !(t.due_at && new Date(t.due_at).getTime() < now));
        return (
          <div className="space-y-4">
            {late.length > 0 && (
              <section className="card p-4 border-red-200">
                <h2 className="h2 mb-1 text-red-700">Vencidas ({late.length})</h2>
                <TaskList tasks={late} showJob />
              </section>
            )}
            <section className="card p-4">
              <h2 className="h2 mb-1">Pendientes ({rest.length})</h2>
              <TaskList tasks={rest} showJob />
            </section>
          </div>
        );
      })()}
      {ver === "hechas" && (
        <section className="card p-4">
          <TaskList tasks={(data ?? []) as any[]} showJob />
        </section>
      )}
    </>
  );
}
