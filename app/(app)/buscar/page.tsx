import Link from "next/link";
import { getSession } from "@/lib/auth";
import { fullName, telHref } from "@/lib/format";
import { Empty, PageHeader, Section, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/icons";

// Búsqueda global: trabajos y contactos que el usuario puede ver (RLS)
export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const { supabase } = await getSession();
  const q = (searchParams.q ?? "").trim();
  const s = q.replace(/[%,()]/g, " ");
  const [jobs, contacts] = q ? await Promise.all([
    supabase.from("jobs").select("id, number, name, status, address, city, zip, insurer, claim_number")
      .or(`name.ilike.%${s}%,address.ilike.%${s}%,claim_number.ilike.%${s}%,insurer.ilike.%${s}%,zip.ilike.%${s}%`).limit(25),
    supabase.from("contacts").select("id, first_name, last_name, phone, address, city, zip")
      .or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,phone.ilike.%${s}%,address.ilike.%${s}%,zip.ilike.%${s}%,email.ilike.%${s}%`).limit(25),
  ]) : [{ data: [] }, { data: [] }];
  const J = (jobs.data ?? []) as any[], C = (contacts.data ?? []) as any[];
  return (
    <>
      <PageHeader title="Buscar" sub={q ? `${J.length + C.length} resultado(s) para “${q}”` : "Leads, clientes, direcciones, claims o ZIP"} />
      <form className="relative mb-5" role="search">
        <Icon name="search" className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input className="input pl-9" name="q" defaultValue={q} type="search" autoFocus placeholder="Buscar leads, clientes, direcciones…" aria-label="Buscar en el CRM" />
      </form>
      {!q ? null : J.length + C.length === 0 ? <Empty icon="search">Sin resultados.</Empty> : (
        <div className="grid lg:grid-cols-2 gap-5">
          <Section title={`Trabajos (${J.length})`}>
            {J.length === 0 ? <p className="muted">Sin trabajos.</p> : (
              <ul className="divide-y divide-line/70">
                {J.map((j) => (
                  <li key={j.id}>
                    <Link href={`/trabajos/${j.id}`} className="flex items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">#{j.number} {j.name}</span>
                        <span className="block text-xs text-muted truncate">{[j.address, j.city, j.zip].filter(Boolean).join(", ") || j.insurer}</span>
                      </span>
                      <StatusBadge status={j.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title={`Contactos (${C.length})`}>
            {C.length === 0 ? <p className="muted">Sin contactos.</p> : (
              <ul className="divide-y divide-line/70">
                {C.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <Link href={`/contactos/${c.id}`} className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{fullName(c)}</span>
                      <span className="block text-xs text-muted truncate">{[c.address, c.city, c.zip].filter(Boolean).join(", ")}</span>
                    </Link>
                    {c.phone && <a href={telHref(c.phone)} className="btn-secondary btn-sm"><Icon name="phone" className="w-4 h-4" /></a>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </>
  );
}
