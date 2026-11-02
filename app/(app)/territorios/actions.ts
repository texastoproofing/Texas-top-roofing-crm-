"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { str } from "@/lib/format";

export async function updateStreet(id: string, territoryId: string, fd: FormData) {
  const { supabase, profile } = await getSession();
  const { data: s } = await supabase.from("territory_streets").select("doors_knocked").eq("id", id).maybeSingle();
  if (!s) return;
  const add = Number(fd.get("add_doors") ?? 0) || 0;
  const status = str(fd, "status");
  const notes = fd.has("notes") ? str(fd, "notes") : undefined;
  const patch: Record<string, unknown> = {
    last_visit_at: new Date().toISOString(),
    last_visit_by: profile.id,
    doors_knocked: Math.max(0, (s.doors_knocked ?? 0) + add),
  };
  if (status) patch.status = status;
  else if (add > 0) patch.status = "en_progreso";
  if (notes !== undefined) patch.notes = notes;
  await supabase.from("territory_streets").update(patch).eq("id", id);
  revalidatePath(`/territorios/${territoryId}`);
  revalidatePath("/territorios");
}
