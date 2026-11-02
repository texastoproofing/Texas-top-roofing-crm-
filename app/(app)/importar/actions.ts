"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { STATUSES } from "@/lib/constants";
import type { ImportRow } from "@/lib/trello";

export async function importTrello(rows: ImportRow[], ownerId: string | null) {
  const { supabase, profile } = await requireAdmin();
  const owner = ownerId || profile.id;
  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const r of rows.slice(0, 1000)) {
    const ref = "trello:" + r.cardId;
    const { data: exists } = await supabase.from("contacts").select("id").eq("external_ref", ref).maybeSingle();
    if (exists) { skipped++; continue; }

    const { data: c, error: ce } = await supabase.from("contacts").insert({
      first_name: r.first_name || "Sin nombre",
      last_name: r.last_name,
      phone: r.phone, email: r.email, address: r.address, city: r.city, zip: r.zip,
      source: "trello", owner_id: owner, external_ref: ref,
      notes: `Importado de Trello (lista "${r.list}").\n\n${r.desc}`.trim(),
    }).select("id").single();
    if (ce || !c) { errors.push(`${r.first_name} ${r.last_name}: ${ce?.message}`); continue; }

    const status = STATUSES.some((s) => s.key === r.status) ? r.status : "lead_nuevo";
    const { error: je } = await supabase.from("jobs").insert({
      contact_id: c.id,
      name: `Techo – ${[r.first_name, r.last_name].filter(Boolean).join(" ")}`,
      job_type: "seguro",
      status,
      sales_rep_id: owner,
      address: r.address, city: r.city, zip: r.zip,
      insurer: r.insurer, claim_number: r.claim_number, policy_number: r.policy_number,
      date_of_loss: r.date_of_loss,
      external_ref: ref,
      notes: r.desc || null,
    });
    if (je) { errors.push(`${r.first_name} ${r.last_name} (trabajo): ${je.message}`); continue; }
    created++;
  }
  revalidatePath("/trabajos");
  revalidatePath("/contactos");
  return { created, skipped, errors };
}
