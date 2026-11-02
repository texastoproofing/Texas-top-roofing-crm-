"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { STATUSES } from "@/lib/constants";
import { localToISO, num, str } from "@/lib/format";

function jobFromForm(fd: FormData) {
  return {
    name: str(fd, "name") ?? "",
    job_type: str(fd, "job_type") ?? "seguro",
    sales_rep_id: str(fd, "sales_rep_id"),
    pm_id: str(fd, "pm_id"),
    address: str(fd, "address"),
    city: str(fd, "city"),
    zip: str(fd, "zip"),
    territory_id: str(fd, "territory_id"),
    storm_date: str(fd, "storm_date"),
    insurer: str(fd, "insurer"),
    policy_number: str(fd, "policy_number"),
    claim_number: str(fd, "claim_number"),
    date_of_loss: str(fd, "date_of_loss"),
    adjuster_name: str(fd, "adjuster_name"),
    adjuster_phone: str(fd, "adjuster_phone"),
    adjuster_email: str(fd, "adjuster_email"),
    estimate_amount: num(fd, "estimate_amount"),
    approved_amount: num(fd, "approved_amount"),
    deductible: num(fd, "deductible"),
    notes: str(fd, "notes"),
  };
}

export async function createJob(fd: FormData) {
  const { supabase, profile } = await getSession();
  let contactId = str(fd, "contact_id");

  // Contacto nuevo en el mismo formulario (flujo rápido de door-to-door)
  if (!contactId) {
    const first = str(fd, "c_first_name");
    if (!first) throw new Error("Escoge un contacto o escribe el nombre del cliente.");
    const { data: c, error } = await supabase.from("contacts").insert({
      first_name: first,
      last_name: str(fd, "c_last_name") ?? "",
      phone: str(fd, "c_phone"),
      email: str(fd, "c_email"),
      address: str(fd, "address"),
      city: str(fd, "city"),
      zip: str(fd, "zip"),
      source: str(fd, "c_source") ?? "door_to_door",
      lead_cost: num(fd, "c_lead_cost"),
      territory_id: str(fd, "territory_id"),
      owner_id: str(fd, "sales_rep_id") ?? profile.id,
    }).select("id").single();
    if (error) throw new Error(error.message);
    contactId = c.id;
  }

  const row = jobFromForm(fd);
  if (!row.sales_rep_id) row.sales_rep_id = profile.id;
  if (!row.name) {
    const { data: c } = await supabase.from("contacts").select("first_name, last_name").eq("id", contactId).maybeSingle();
    row.name = `Techo – ${[c?.first_name, c?.last_name].filter(Boolean).join(" ") || "cliente"}`;
  }
  const status = str(fd, "status") ?? "lead_nuevo";
  const { data, error } = await supabase.from("jobs")
    .insert({ ...row, contact_id: contactId, status })
    .select("id").single();
  if (error) throw new Error(error.message);

  // Si viene de una calle del territorio, suma 1 lead a esa calle
  const streetId = str(fd, "street_id");
  if (streetId) {
    const { data: s } = await supabase.from("territory_streets").select("leads").eq("id", streetId).maybeSingle();
    if (s) await supabase.from("territory_streets").update({ leads: (s.leads ?? 0) + 1 }).eq("id", streetId);
  }

  // Cita inicial opcional
  const appt = localToISO(str(fd, "appt_at"));
  if (appt) {
    await supabase.from("appointments").insert({
      title: `Inspección · ${row.name}`, kind: "inspeccion", starts_at: appt,
      location: [row.address, row.city, row.zip].filter(Boolean).join(", ") || null,
      assigned_to: row.sales_rep_id, job_id: data.id, contact_id: contactId,
    });
  }

  revalidatePath("/trabajos");
  redirect(`/trabajos/${data.id}`);
}

export async function updateJob(id: string, fd: FormData) {
  const { supabase } = await getSession();
  const row: Record<string, unknown> = jobFromForm(fd);
  if (!row.name) delete row.name;
  if (!row.sales_rep_id) delete row.sales_rep_id; // vacío = no cambiar vendedor
  const { error } = await supabase.from("jobs").update(row).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/trabajos/${id}`);
  redirect(`/trabajos/${id}`);
}

export async function setJobStatus(id: string, fd: FormData) {
  const { supabase } = await getSession();
  const status = str(fd, "status");
  if (!status || !STATUSES.some((s) => s.key === status)) return;
  const { error } = await supabase.from("jobs").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/trabajos");
  revalidatePath(`/trabajos/${id}`);
}

export async function addJobNote(id: string, contactId: string, fd: FormData) {
  const { supabase, profile } = await getSession();
  const body = str(fd, "body");
  if (!body) return;
  await supabase.from("activities").insert({
    job_id: id, contact_id: contactId, author_id: profile.id, kind: str(fd, "kind") ?? "nota", body,
  });
  revalidatePath(`/trabajos/${id}`);
}

export async function deleteJob(id: string) {
  const { supabase } = await getSession();
  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/trabajos");
  redirect("/trabajos");
}
