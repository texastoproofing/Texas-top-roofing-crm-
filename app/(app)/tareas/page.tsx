import Link from "next/link";
import { getSession, isStaff, listProfiles } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { TaskForm, TaskList } from "@/components/TaskList";

export default async function TasksPage({ searchParams }: { searchParams: { ver?: string } }) {
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
      <PageHeader title="Tareas" />
      <div className="flex gap-2 mb-4">
        {tabs.map((t) => (
          <Link key={t.k} href={`/tareas?ver=${t.k}`} className={`chip py-1.5 ${ver === t.k ? "bg-gray-900 text-white border-gray-900" : "bg-white"}`}>{t.l}</Link>
        ))}
      </div>
      <section className="card p-4 mb-4">
        <TaskForm users={users.filter((u) => u.active)} me={profile.id} />
      </section>
      <section className="card p-4">
        <TaskList tasks={(data ?? []) as any[]} showJob />
      </section>
    </>
  );
}
