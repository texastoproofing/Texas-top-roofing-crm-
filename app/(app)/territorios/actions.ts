"use server";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { importOwnersForTerritory } from "@/lib/owners-server";
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

// Dueños de las casas (registro público del condado de Bexar). Solo administradores.
export async function loadOwners(territoryId: string): Promise<{ ok: true; houses: number; remaining: number; notes: string[] } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const r = await importOwnersForTerritory(territoryId);
    revalidatePath(`/territorios/${territoryId}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: (e as Error).message.includes("SUPABASE_SERVICE_ROLE_KEY") ? (e as Error).message : "No se pudieron cargar los dueños." };
  }
}
