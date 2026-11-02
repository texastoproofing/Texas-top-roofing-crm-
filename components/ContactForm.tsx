import { SOURCES } from "@/lib/constants";
import { Field, Select, TextArea } from "./ui";

export type ContactRow = {
  first_name?: string | null; last_name?: string | null; company?: string | null; phone?: string | null;
  phone2?: string | null; email?: string | null; address?: string | null; city?: string | null; state?: string | null;
  zip?: string | null; source?: string | null; lead_cost?: number | null; owner_id?: string | null;
  territory_id?: string | null; notes?: string | null;
};

export function ContactFields({ c = {}, users, territories }: {
  c?: ContactRow;
  users: { id: string; full_name: string }[];
  territories: { id: string; code: string; name: string }[];
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <Field label="Nombre" name="first_name" defaultValue={c.first_name} required />
      <Field label="Apellido" name="last_name" defaultValue={c.last_name} />
      <Field label="Teléfono" name="phone" type="tel" inputMode="tel" defaultValue={c.phone} />
      <Field label="Teléfono 2" name="phone2" type="tel" inputMode="tel" defaultValue={c.phone2} />
      <Field label="Correo" name="email" type="email" defaultValue={c.email} />
      <Field label="Empresa (opcional)" name="company" defaultValue={c.company} />
      <div className="sm:col-span-2"><Field label="Dirección" name="address" defaultValue={c.address} placeholder="1234 Main St" /></div>
      <Field label="Ciudad" name="city" defaultValue={c.city} />
      <div className="grid grid-cols-2 gap-4">
        <Field label="Estado" name="state" defaultValue={c.state ?? "TX"} />
        <Field label="ZIP" name="zip" inputMode="numeric" defaultValue={c.zip} />
      </div>
      <Select label="Origen" name="source" defaultValue={c.source ?? "door_to_door"}
        options={SOURCES.map((s) => ({ value: s.key, label: s.label }))} />
      <Field label="Costo del lead (USD)" name="lead_cost" inputMode="decimal" defaultValue={c.lead_cost} placeholder="140" />
      <Select label="Responsable" name="owner_id" defaultValue={c.owner_id} empty="Yo"
        options={users.map((u) => ({ value: u.id, label: u.full_name }))} />
      <Select label="Territorio" name="territory_id" defaultValue={c.territory_id} empty="—"
        options={territories.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} />
      <div className="sm:col-span-2"><TextArea label="Notas" name="notes" defaultValue={c.notes} /></div>
    </div>
  );
}
