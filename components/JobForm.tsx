import { INSURERS } from "@/lib/constants";
import { Field, Select, TextArea } from "./ui";

export type JobRow = Record<string, any>;
type Opt = { id: string; full_name: string; role?: string };

export function JobFields({ j = {}, users, territories }: {
  j?: JobRow; users: Opt[]; territories: { id: string; code: string; name: string }[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Field label="Nombre del trabajo" name="name" defaultValue={j.name} placeholder="Se llena solo: Techo – Nombre del cliente" /></div>
        <Select label="Tipo" name="job_type" defaultValue={j.job_type ?? "seguro"}
          options={[{ value: "seguro", label: "Seguro (claim)" }, { value: "retail", label: "Retail (pago directo)" }]} />
        <Select label="Vendedor" name="sales_rep_id" defaultValue={j.sales_rep_id} empty="Yo"
          options={users.map((u) => ({ value: u.id, label: u.full_name }))} />
        <Select label="Project manager" name="pm_id" defaultValue={j.pm_id} empty="—"
          options={users.filter((u) => !u.role || u.role !== "vendedor").map((u) => ({ value: u.id, label: u.full_name }))} />
        <Select label="Territorio" name="territory_id" defaultValue={j.territory_id} empty="—"
          options={territories.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} />
        <div className="sm:col-span-2"><Field label="Dirección de la propiedad" name="address" defaultValue={j.address} /></div>
        <Field label="Ciudad" name="city" defaultValue={j.city} />
        <Field label="ZIP" name="zip" inputMode="numeric" defaultValue={j.zip} />
        <Field label="Fecha de la tormenta" name="storm_date" type="date" defaultValue={j.storm_date} />
      </div>

      <fieldset className="grid sm:grid-cols-2 gap-4">
        <legend className="h2 mb-3">Seguro</legend>
        <div>
          <label className="label" htmlFor="insurer">Aseguradora</label>
          <input className="input" id="insurer" name="insurer" list="insurers" defaultValue={j.insurer ?? ""} />
          <datalist id="insurers">{INSURERS.map((i) => <option key={i} value={i} />)}</datalist>
        </div>
        <Field label="Fecha de pérdida (DOL)" name="date_of_loss" type="date" defaultValue={j.date_of_loss} />
        <Field label="Número de póliza" name="policy_number" defaultValue={j.policy_number} />
        <Field label="Número de claim" name="claim_number" defaultValue={j.claim_number} />
        <Field label="Ajustador" name="adjuster_name" defaultValue={j.adjuster_name} />
        <Field label="Teléfono ajustador" name="adjuster_phone" type="tel" defaultValue={j.adjuster_phone} />
        <Field label="Correo ajustador" name="adjuster_email" type="email" defaultValue={j.adjuster_email} />
      </fieldset>

      <fieldset className="grid sm:grid-cols-3 gap-4">
        <legend className="h2 mb-3">Montos</legend>
        <Field label="Estimado (USD)" name="estimate_amount" inputMode="decimal" defaultValue={j.estimate_amount} />
        <Field label="Aprobado (USD)" name="approved_amount" inputMode="decimal" defaultValue={j.approved_amount} />
        <Field label="Deducible (USD)" name="deductible" inputMode="decimal" defaultValue={j.deductible} />
      </fieldset>

      <TextArea label="Notas del trabajo" name="notes" defaultValue={j.notes} rows={4} />
    </div>
  );
}
