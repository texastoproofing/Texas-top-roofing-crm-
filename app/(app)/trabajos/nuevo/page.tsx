import { getSession, listProfiles } from "@/lib/auth";
import { SOURCES, STAGES, STATUSES } from "@/lib/constants";
import { fullName } from "@/lib/format";
import { Field, PageHeader, Select } from "@/components/ui";
import { JobFields } from "@/components/JobForm";
import { createJob } from "../actions";
import { ownerToPerson } from "@/lib/owners";

export default async function NewJob({ searchParams }: { searchParams: { contacto?: string; calle?: string; casa?: string } }) {
  const { supabase } = await getSession();
  const [users, terr, contacts] = await Promise.all([
    listProfiles(),
    supabase.from("territories").select("id, code, name, city, zip, storm_date").order("priority"),
    supabase.from("contacts").select("id, first_name, last_name, address, city, zip").order("created_at", { ascending: false }).limit(300),
  ]);

  // Prefill desde un contacto o desde una calle del territorio
  const prefill: Record<string, any> = {};
  const contact = searchParams.contacto ? (contacts.data ?? []).find((c) => c.id === searchParams.contacto) : undefined;
  if (contact) Object.assign(prefill, { name: `Techo – ${fullName(contact)}`, address: contact.address, city: contact.city, zip: contact.zip });
  let streetId: string | undefined;
  if (searchParams.calle) {
    const { data: s } = await supabase.from("territory_streets").select("id, name, territory_id").eq("id", searchParams.calle).maybeSingle();
    if (s) {
      const t = (terr.data ?? []).find((x) => x.id === s.territory_id);
      streetId = s.id;
      Object.assign(prefill, { address: ` ${s.name}`, city: t?.city, zip: t?.zip, territory_id: s.territory_id, storm_date: t?.storm_date });
    }
  }
  // Casa con dueño (registro del condado): llena dirección y nombre si el dueño es una persona
  let owner: { first: string; last: string } | null = null;
  let ownerRaw: string | null = null;
  if (searchParams.casa && streetId) {
    const { data: h } = await supabase.from("street_houses").select("situs, owner_name, street_id").eq("id", searchParams.casa).maybeSingle();
    if (h && h.street_id === streetId) {
      const [line] = String(h.situs).split(",");
      prefill.address = line;
      owner = ownerToPerson(h.owner_name);
      ownerRaw = h.owner_name;
      if (owner) prefill.name = `Techo – ${owner.first} ${owner.last}`;
    }
  }
  const active = users.filter((u) => u.active);

  return (
    <>
      <PageHeader title="Nuevo trabajo" sub="Lead → trabajo, igual que en JobNimbus" />
      <form action={createJob} className="space-y-5">
        {streetId && <input type="hidden" name="street_id" value={streetId} />}
        <section className="card p-4 space-y-4">
          <h2 className="h2">Cliente</h2>
          {contact ? (
            <>
              <input type="hidden" name="contact_id" value={contact.id} />
              <p className="font-semibold">{fullName(contact)}</p>
            </>
          ) : (
            <>
              <Select label="Contacto existente" name="contact_id" empty="— Cliente nuevo (llenar abajo) —"
                options={(contacts.data ?? []).map((c) => ({ value: c.id, label: `${fullName(c)}${c.address ? " · " + c.address : ""}` }))} />
              <div className="grid sm:grid-cols-2 gap-4 border-t pt-4">
                {ownerRaw && <p className="sm:col-span-2 text-xs text-gray-600">Dueño según el condado: <b>{ownerRaw}</b>. Confirma el nombre con la persona.</p>}
                <Field label="Nombre (cliente nuevo)" name="c_first_name" defaultValue={owner?.first} />
                <Field label="Apellido" name="c_last_name" defaultValue={owner?.last} />
                <Field label="Teléfono" name="c_phone" type="tel" inputMode="tel" />
                <Field label="Correo" name="c_email" type="email" />
                <Select label="Origen" name="c_source" defaultValue={streetId ? "door_to_door" : "lead_comprado"}
                  options={SOURCES.filter((s) => s.key !== "trello").map((s) => ({ value: s.key, label: s.label }))} />
                <Field label="Costo del lead (USD)" name="c_lead_cost" inputMode="decimal" placeholder="140" />
              </div>
            </>
          )}
        </section>

        <section className="card p-4 space-y-4">
          <h2 className="h2">Trabajo</h2>
          <Select label="Estado inicial" name="status" defaultValue="lead_nuevo"
            options={STATUSES.filter((s) => STAGES.slice(0, 3).some((st) => st.key === s.stage)).map((s) => ({ value: s.key, label: s.label }))} />
          <JobFields j={prefill} users={active} territories={terr.data ?? []} />
          <Field label="Agendar inspección (opcional)" name="appt_at" type="datetime-local" />
        </section>

        <button className="btn-primary w-full sm:w-auto">Crear trabajo</button>
      </form>
    </>
  );
}
