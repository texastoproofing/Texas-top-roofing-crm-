import { getSession } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { ActionForm } from "@/components/sales/client";
import { addPayment, saveJobFinancials, saveSplits } from "@/app/(app)/rendimiento/actions";

const usd2 = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));

/** Finanzas del trabajo: solo administrador (RLS de job_financials también lo exige). */
export async function JobFinance({ jobId, users }: { jobId: string; users: { id: string; full_name: string }[] }) {
  const { supabase, profile } = await getSession();
  if (profile.role !== "administrador") return null;
  const [fin, pays, splits] = await Promise.all([
    supabase.from("job_financials").select("contract_amount, direct_costs, notes, updated_at").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_payments").select("id, amount, received_on, method, note").eq("job_id", jobId).order("received_on"),
    supabase.from("job_splits").select("user_id, share_pct").eq("job_id", jobId),
  ]);
  if (fin.error && pays.error) return <section className="card p-4 text-sm text-muted">Finanzas: falta activar la migración 0011.</section>;
  const f = fin.data;
  const collected = (pays.data ?? []).reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0) / 100;
  const profit = f?.contract_amount != null && f?.direct_costs != null ? Number(f.contract_amount) - Number(f.direct_costs) : null;
  const sp = splits.data ?? [];
  return (
    <section id="finanzas" className="card p-4 scroll-mt-28 space-y-3">
      <h2 className="h2">Finanzas <span className="text-xs font-normal text-muted">(solo administrador)</span></h2>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-canvas p-2"><div className="font-bold tnum text-sm">{usd2(f?.contract_amount)}</div>Contrato</div>
        <div className="rounded-lg bg-canvas p-2"><div className="font-bold tnum text-sm">{usd2(collected || null)}</div>Cobrado</div>
        <div className="rounded-lg bg-canvas p-2"><div className="font-bold tnum text-sm">{usd2(profit)}</div>Profit bruto</div>
      </div>
      <ActionForm resetOnOk={false} submit="Guardar montos" action={async (x) => { "use server"; return saveJobFinancials({ jobId, contract: x.contract, costs: x.costs, notes: x.notes }); }}>
        <div className="grid grid-cols-2 gap-2">
          <label className="label">Valor del contrato (USD)<input name="contract" className="input mt-1" inputMode="decimal" defaultValue={f?.contract_amount ?? ""} /></label>
          <label className="label">Costos directos (USD)<input name="costs" className="input mt-1" inputMode="decimal" defaultValue={f?.direct_costs ?? ""} /></label>
        </div>
        <input name="notes" className="input" placeholder="Nota (qué incluyen los costos)" defaultValue={f?.notes ?? ""} maxLength={500} aria-label="Nota" />
      </ActionForm>
      <div className="border-t border-line pt-3">
        <h3 className="text-sm font-semibold mb-1">Pagos recibidos</h3>
        {pays.data?.length ? <ul className="text-sm divide-y divide-line mb-2">{pays.data.map((p) => <li key={p.id} className="py-1 flex justify-between gap-2"><span>{fmtDate(p.received_on)}{p.method && ` · ${p.method}`}{p.note && <span className="text-muted"> · {p.note}</span>}</span><span className="tnum font-semibold">{usd2(Number(p.amount))}</span></li>)}</ul> : <p className="text-xs text-muted mb-2">Sin pagos registrados.</p>}
        <ActionForm submit="Registrar pago" action={async (x) => { "use server"; return addPayment({ jobId, amount: x.amount, receivedOn: x.receivedOn, method: x.method, note: x.note }); }}>
          <div className="grid grid-cols-2 gap-2">
            <input name="amount" className="input" inputMode="decimal" placeholder="Monto" aria-label="Monto" required />
            <input name="receivedOn" type="date" className="input" aria-label="Fecha" required />
            <select name="method" className="input" aria-label="Método"><option value="">Método</option><option>Cheque de seguro</option><option>Cheque</option><option>Transferencia</option><option>Tarjeta</option><option>Efectivo</option><option>Financiamiento</option></select>
            <input name="note" className="input" placeholder="Nota" aria-label="Nota" maxLength={300} />
          </div>
          <p className="text-[11px] text-muted">Los pagos no se borran; para corregir uno, registra el mismo monto en negativo.</p>
        </ActionForm>
      </div>
      <details className="border-t border-line pt-3">
        <summary className="text-sm font-semibold cursor-pointer">Venta compartida {sp.length ? `(${sp.length} vendedores)` : "(100% del vendedor del trabajo)"}</summary>
        <ActionForm resetOnOk={false} className="mt-2" submit="Guardar partes" action={async (x) => { "use server"; return saveSplits({ jobId, rows: [0, 1, 2].map((i) => ({ userId: x[`u${i}`] ?? "", pct: x[`p${i}`] ?? "" })) }); }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-[1fr_90px] gap-2">
              <select name={`u${i}`} className="input" defaultValue={sp[i]?.user_id ?? ""} aria-label={`Vendedor ${i + 1}`}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
              <input name={`p${i}`} className="input" inputMode="decimal" placeholder="%" defaultValue={sp[i] ? Number(sp[i].share_pct) : ""} aria-label={`Porcentaje ${i + 1}`} />
            </div>
          ))}
          <p className="text-[11px] text-muted">Las partes deben sumar 100%. Deja todo vacío para que la venta sea 100% del vendedor del trabajo.</p>
        </ActionForm>
      </details>
    </section>
  );
}
