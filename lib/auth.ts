import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: "administrador" | "vendedor" | "project_manager" | "asistente";
  active: boolean;
};

export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || !profile.active) redirect("/login?error=inactivo");
  return { supabase, user, profile: profile as Profile };
}

export async function requireAdmin() {
  const s = await getSession();
  if (s.profile.role !== "administrador") redirect("/");
  return s;
}

export const isStaff = (p: Profile) => p.role !== "vendedor";

export async function listProfiles() {
  const supabase = createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, role, active").order("full_name");
  return (data ?? []) as Pick<Profile, "id" | "full_name" | "role" | "active">[];
}
