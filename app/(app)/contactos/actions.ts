"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { num, str } from "@/lib/format";

function contactFromForm(fd: FormData) {
  return {
    first_name: str(fd, "first_name") ?? "",
    last_name: str(fd, "last_name") ?? "",
    company: str(fd, "company"),
    phone: str(fd, "phone"),
    phone2: str(fd, "phone2"),
    email: str(fd, "email"),
    address: str(fd, "address"),
    city: str(fd, "city"),
    state: str(fd, "state") ?? "TX",
    zip: str(fd, "zip"),
    source: str(fd, "source") ?? "otro",
    lead_cost: num(fd, "lead_cost"),
    owner_id: str(fd, "owner_id"),
    territory_id: str(fd, "territory_id"),
    notes: str(fd, "notes"),
  };
}

export async function createContact(fd: FormData) {
  const { supabase, profile } = await getSession();
  const row = contactFromForm(fd);
  if (!row.owner_id) row.owner_id = profile.id;
  const { data, error } = await supabase.from("contacts").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath("/contactos");
  redirect(`/contactos/${data.id}`);
}

export async function updateContact(id: string, fd: FormData) {
  const { supabase } = await getSession();
  const { error } = await supabase.from("contacts").update(contactFromForm(fd)).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/contactos/${id}`);
  redirect(`/contactos/${id}`);
}

export async function deleteContact(id: string) {
  const { supabase } = await getSession();
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/contactos");
  redirect("/contactos");
}

export async function addContactNote(id: string, fd: FormData) {
  const { supabase, profile } = await getSession();
  const body = str(fd, "body");
  if (!body) return;
  await supabase.from("activities").insert({ contact_id: id, author_id: profile.id, kind: str(fd, "kind") ?? "nota", body });
  revalidatePath(`/contactos/${id}`);
}
