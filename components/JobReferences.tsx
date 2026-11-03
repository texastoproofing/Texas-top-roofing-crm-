import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NearbyList } from "@/components/map/MapApp";
import type { NearbyRef } from "@/app/(app)/mapa/actions";
import { setReferenceAuthorization } from "@/app/(app)/trabajos/actions";
import { fmtDateTime } from "@/lib/format";
import { groupInfo, mapGroupOf } from "@/lib/map";

// Tarjetas del trabajo: ubicación en el mapa, referencias cercanas y autorización de referencia
export async function JobReferences({ job, canEdit }: {
  job: { id: string; status: string; reference_authorized: boolean; reference_authorized_at: string | null; reference_note: string | null };
  canEdit: boolean;
}) {
  const supabase = createClient();
  const [{ data: loc }, near] = await Promise.all([
    supabase.from("job_locations").select("status, source, matched_address").eq("job_id", job.id).maybeSingle(),
    supabase.rpc("nearby_jobs", { p_job: job.id, p_radius_m: 1609 }),
  ]);
  const isRef = !!groupInfo(mapGroupOf(job.status)).reference;
  const refs = (near.data ?? []) as NearbyRef[];

  return (
    <>
      {!isRef && (
        <section className="card p-4">
          <h2 className="h2 mb-2">Referencias cercanas</h2>
          {loc?.status !== "ok" ? (
            <p className="text-sm text-gray-600">
              Este trabajo aún no tiene ubicación en el mapa, así que no se pueden buscar vecinos.{" "}
              <Link href="/mapa" className="text-brand font-semibold">Revisar en el mapa</Link>
            </p>
          ) : near.error ? (
            <p className="text-sm text-red-700">No se pudieron buscar trabajos cercanos.</p>
          ) : (
            <NearbyList refs={refs} />
          )}
          <p className="text-xs text-gray-500 mt-2">Trabajos con contrato firmado, en proceso o terminados a menos de 1 milla. La distancia es en línea recta.</p>
        </section>
      )}

      {isRef && (
        <section className="card p-4">
          <h2 className="h2 mb-2">Referencia comercial</h2>
          <p className="text-sm text-gray-600 mb-3">
            Marca esto solo si el cliente dio permiso para mencionar su trabajo a vecinos. Sin permiso, el CRM no muestra su nombre ni su dirección a otros vendedores.
          </p>
          {canEdit ? (
            <form action={setReferenceAuthorization.bind(null, job.id)} className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="authorized" defaultChecked={job.reference_authorized} className="w-5 h-5" />
                El cliente autorizó usar su trabajo como referencia
              </label>
              <input className="input" name="reference_note" defaultValue={job.reference_note ?? ""} placeholder="Cómo y cuándo lo autorizó (ej.: por texto el 3/11)" />
              <button className="btn-secondary w-full">Guardar</button>
            </form>
          ) : (
            <p className="text-sm">{job.reference_authorized ? "Autorizada" : "No autorizada"}</p>
          )}
          {job.reference_authorized && job.reference_authorized_at && (
            <p className="text-xs text-gray-500 mt-2">Autorizada el {fmtDateTime(job.reference_authorized_at)}</p>
          )}
        </section>
      )}

      <section className="card p-4">
        <h2 className="h2 mb-1">Ubicación</h2>
        <p className="text-sm text-gray-600">
          {loc?.status === "ok"
            ? (loc.source === "manual" ? "Marcada a mano en el mapa." : `Ubicada: ${loc.matched_address ?? ""}`)
            : loc?.status === "ambigua" ? "Dirección ambigua: elige la correcta en el mapa (Por revisar)."
            : loc?.status === "sin_resultado" ? "No se encontró la dirección. Corrígela o márcala en el mapa."
            : loc?.status === "error" ? "El servicio de ubicación falló; se reintentará."
            : "Se ubicará al abrir el mapa."}
        </p>
        <Link href="/mapa" className="text-sm font-semibold text-brand">Ver en el mapa</Link>
      </section>
    </>
  );
}
