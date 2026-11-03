import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { createTask, deleteTask, toggleTask } from "@/app/(app)/tareas/actions";

export type TaskItem = {
  id: string; title: string; description?: string | null; due_at: string | null; done: boolean;
  job_id: string | null; assignee?: { full_name: string } | null; job?: { number: number; name: string } | null;
};

export function TaskList({ tasks, showJob }: { tasks: TaskItem[]; showJob?: boolean }) {
  const now = Date.now();
  if (tasks.length === 0) return <p className="muted">Sin tareas.</p>;
  return (
    <ul className="divide-y divide-line/70">
      {tasks.map((t) => {
        const late = !t.done && t.due_at && new Date(t.due_at).getTime() < now;
        return (
          <li key={t.id} className="flex items-start gap-3 py-2.5">
            <form action={toggleTask.bind(null, t.id, !t.done, t.job_id)}>
              <button aria-label={t.done ? "Marcar pendiente" : "Marcar hecha"}
                className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center ${t.done ? "bg-green-600 border-green-600 text-white" : "border-line hover:border-ink/40"}`}>
                {t.done && "✓"}
              </button>
            </form>
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${t.done ? "line-through text-muted" : ""}`}>{t.title}</div>
              {t.description && <div className="text-sm text-gray-600 whitespace-pre-wrap">{t.description}</div>}
              <div className="text-xs text-gray-500 flex flex-wrap gap-x-2">
                {t.due_at && <span className={late ? "text-red-600 font-semibold" : ""}>{late ? "Vencida · " : ""}{fmtDateTime(t.due_at)}</span>}
                {t.assignee?.full_name && <span>{t.assignee.full_name}</span>}
                {showJob && t.job && <Link className="text-brand font-semibold" href={`/trabajos/${t.job_id}`}>#{t.job.number} {t.job.name}</Link>}
              </div>
            </div>
            <form action={deleteTask.bind(null, t.id, t.job_id)}>
              <button className="text-gray-400 hover:text-red-600 text-sm px-1" aria-label="Borrar tarea">✕</button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}

export function TaskForm({ users, jobId, contactId, me, autoFocus }: {
  users: { id: string; full_name: string }[]; jobId?: string; contactId?: string; me: string; autoFocus?: boolean;
}) {
  return (
    <form action={createTask}
      className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
      {jobId && <input type="hidden" name="job_id" value={jobId} />}
      {contactId && <input type="hidden" name="contact_id" value={contactId} />}
      <input className="input" name="title" placeholder="Nueva tarea…" required autoFocus={autoFocus} aria-label="Nueva tarea" />
      <input className="input" name="due_at" type="datetime-local" aria-label="Vence" />
      <select className="input" name="assigned_to" defaultValue={me} aria-label="Asignar a">
        {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
      </select>
      <button className="btn-primary">Agregar</button>
    </form>
  );
}
