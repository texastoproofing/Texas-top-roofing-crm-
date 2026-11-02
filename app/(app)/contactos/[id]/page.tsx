import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, listProfiles } from "@/lib/auth";
import { sourceLabel } from "@/lib/constants";
import { fmtDateTime, fmtMoney, fullName, mapsHref, telHref } from "@/lib/format";
import { KV, StatusBadge } from "@/components/ui";
import { ContactFields } from "@/components/ContactForm";
import { ActivityFeed } from "@/components/ActivityFeed";
import { addContactNote, deleteContact, updateContact } from "../actions";

export default async function ContactPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await getSession();
  const { data: c } = await supabase.from("contacts")
    .select("*, owner:profiles!contacts_owner_id_fkey(full_name), territory:territories(code, name)")
    .eq("id", params.id).maybeSingle();
  if (!c) notFound();

  const [jobs, acts, users, terr] = await Promise.all([
    supabase.from("jobs").select("id, number, name, status, insurer, claim_number").eq("contact_id", c.id).order("created_at", { ascending: false }),
    supabase.from("activities").select("id, kind, body, created_at, author:profiles(full_name)")
      .eq("contact_id", c.id).is("job_id", null).order("created_at", { ascending: false }).limit(50),
    listProfiles(),
    supabase.from("territories").select("id, code, name").order("priority"),
  ]);
  const map = mapsHref([c.address, c.city, c.state, c.zip]);

  return (
    <>
      <div className="mb-5">
        <Link href="/contactos" className="text-sm font-semibold text-brand">← Contactos</Link>
        <h1 className="h1 mt-1">{fullName(c)}</h1>
        <p className="muted">{[c.address, c.city, c.zip].filter(Boolean).join(", ")}</p>
        <div className="flex flex-wrap gap-2 mt-3">
          {c.phone && <a className="btn-primary" href={telHref(c.phone)}>Llamar</a>}
          {c.phone && <a className="btn-secondary" href={"sms:" + c.phone.replace(/[^\d+]/g, "")}>Mensaje</a>}
          {map && <a className="btn-secondary" href={map} target="_blank" rel="noopener">Mapa</a>}
          <Link className="btn-secondary" href={`/trabajos/nuevo?contacto=${c.id}`}>+ Trabajo</Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <section className="card p-4">
            <h2 className="h2 mb-3">Trabajos</h2>
            {(jobs.data ?? []).length === 0 ? <p className="muted">Este contacto no tiene trabajos.</p> : (
              <ul className="divide-y divide-gray-100">
                {jobs.data!.map((j) => (
                  <li key={j.id}>
                    <Link href={`/trabajos/${j.id}`} className="flex items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">#{j.number} {j.name}</div>
                        <div className="muted truncate">{[j.insurer, j.claim_number && `Claim ${j.claim_number}`].filter(Boolean).join(" · ")}</div>
                      </div>
                      <StatusBadge status={j.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="h2 mb-3">Notas</h2>
            <ActivityFeed action={addContactNote.bind(null, c.id)} items={(acts.data ?? []) as any[]} />
          </section>
        </div>

        <aside className="space-y-5">
          <section className="card p-4">
            <h2 className="h2 mb-2">Datos</h2>
            <KV k="Teléfono" v={c.phone} />
            {c.phone2 && <KV k="Teléfono 2" v={c.phone2} />}
            <KV k="Correo" v={c.email} />
            <KV k="Origen" v={sourceLabel(c.source)} />
            {c.lead_cost != null && <KV k="Costo del lead" v={fmtMoney(c.lead_cost)} />}
            <KV k="Responsable" v={(c as any).owner?.full_name} />
            <KV k="Territorio" v={(c as any).territory ? `${(c as any).territory.code} · ${(c as any).territory.name}` : null} />
            <KV k="Creado" v={fmtDateTime(c.created_at)} />
            {c.notes && <p className="text-sm whitespace-pre-wrap mt-3 text-gray-700">{c.notes}</p>}
          </section>

          <details className="card p-4">
            <summary className="font-semibold cursor-pointer">Editar contacto</summary>
            <form action={updateContact.bind(null, c.id)} className="space-y-4 mt-4">
              <ContactFields c={c} users={users.filter((u) => u.active)} territories={terr.data ?? []} />
              <button className="btn-primary w-full">Guardar cambios</button>
            </form>
            {profile.role === "administrador" && (
              <form action={deleteContact.bind(null, c.id)} className="mt-4 border-t pt-4">
                <button className="btn-ghost text-red-600 w-full">Eliminar contacto y sus trabajos</button>
              </form>
            )}
          </details>
        </aside>
      </div>
    </>
  );
}
