"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { localToISO, str } from "@/lib/format";

export async function createTask(fd: FormData) {
  const { supabase, profile } = await getSession();
  const title = str(fd, "title");
  if (!title) return;
  const { error } = await supabase.from("tasks").insert({
    title,
    description: str(fd, "description"),
    due_at: localToISO(str(fd, "due_at")),
    assigned_to: str(fd, "assigned_to") ?? profile.id,
    job_id: str(fd, "job_id"),
    contact_id: str(fd, "contact_id"),
  });
  if (error) throw new Error(error.message);
  const job = str(fd, "job_id");
  if (job) revalidatePath(`/trabajos/${job}`);
  revalidatePath("/tareas");
  revalidatePath("/");
}

export async function toggleTask(id: string, done: boolean, jobId?: string | null) {
  const { supabase } = await getSession();
  await supabase.from("tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", id);
  if (jobId) revalidatePath(`/trabajos/${jobId}`);
  revalidatePath("/tareas");
  revalidatePath("/");
}

export async function deleteTask(id: string, jobId?: string | null) {
  const { supabase } = await getSession();
  await supabase.from("tasks").delete().eq("id", id);
  if (jobId) revalidatePath(`/trabajos/${jobId}`);
  revalidatePath("/tareas");
}
