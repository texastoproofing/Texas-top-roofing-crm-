"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLES } from "@/lib/constants";
import { str } from "@/lib/format";

export async function createUser(fd: FormData) {
  await requireAdmin();
  const email = str(fd, "email")?.toLowerCase();
  const password = str(fd, "password");
  const full_name = str(fd, "full_name") ?? "";
  const role = str(fd, "role") ?? "vendedor";
  if (!email || !password || password.length < 8) redirect("/usuarios?error=datos");
  if (!ROLES.some((r) => r.key === role)) redirect("/usuarios?error=rol");

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name, role },
  });
  if (error || !data.user) redirect("/usuarios?error=" + encodeURIComponent(error?.message ?? "crear"));
  // El trigger crea el perfil; aseguramos nombre, rol y teléfono
  await admin.from("profiles").upsert({
    id: data.user.id, email, full_name, role, phone: str(fd, "phone"), active: true,
  });
  revalidatePath("/usuarios");
  redirect("/usuarios?ok=1");
}

export async function updateUser(id: string, fd: FormData) {
  const { profile } = await requireAdmin();
  const role = str(fd, "role");
  const active = fd.get("active") === "on";
  if (id === profile.id && (role !== "administrador" || !active)) redirect("/usuarios?error=propio");
  const admin = createAdminClient();
  await admin.from("profiles").update({
    full_name: str(fd, "full_name") ?? "", phone: str(fd, "phone"), role, active,
  }).eq("id", id);
  // Usuario desactivado: se le bloquea el inicio de sesión
  await admin.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
  revalidatePath("/usuarios");
}

export async function resetPassword(id: string, fd: FormData) {
  await requireAdmin();
  const password = str(fd, "password");
  if (!password || password.length < 8) redirect("/usuarios?error=datos");
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) redirect("/usuarios?error=" + encodeURIComponent(error.message));
  redirect("/usuarios?ok=2");
}
