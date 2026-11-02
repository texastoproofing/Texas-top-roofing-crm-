"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { localToISO, str } from "@/lib/format";

export async function createAppointment(fd: FormData) {
  const { supabase, profile } = await getSession();
  const starts = localToISO(str(fd, "starts_at"));
  const title = str(fd, "title");
  if (!starts || !title) throw new Error("Falta título o fecha.");
  const { error } = await supabase.from("appointments").insert({
    title,
    kind: str(fd, "kind") ?? "inspeccion",
    starts_at: starts,
    ends_at: localToISO(str(fd, "ends_at")),
    location: str(fd, "location"),
    assigned_to: str(fd, "assigned_to") ?? profile.id,
    job_id: str(fd, "job_id"),
    contact_id: str(fd, "contact_id"),
    notes: str(fd, "notes"),
  });
  if (error) throw new Error(error.message);
  const job = str(fd, "job_id");
  if (job) revalidatePath(`/trabajos/${job}`);
  revalidatePath("/calendario");
  revalidatePath("/");
}

export async function deleteAppointment(id: string, jobId?: string | null) {
  const { supabase } = await getSession();
  await supabase.from("appointments").delete().eq("id", id);
  if (jobId) revalidatePath(`/trabajos/${jobId}`);
  revalidatePath("/calendario");
}
