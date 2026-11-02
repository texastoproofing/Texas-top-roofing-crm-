import Link from "next/link";
import { getSession } from "@/lib/auth";
import { sourceLabel } from "@/lib/constants";
import { fullName, telHref } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";

export default async function ContactsPage({ searchParams }: { searchParams: { q?: string } }) {
  const { supabase } = await getSession();
  const q = (searchParams.q ?? "").trim();
  let query = supabase.from("contacts")
    .select("id, first_name, last_name, company, phone, address, city, zip, source, jobs(count)")
    .order("created_at", { ascending: false }).limit(200);
  if (q) {
    const s = q.replace(/[%,()]/g, " ");
    query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,phone.ilike.%${s}%,address.ilike.%${s}%,zip.ilike.%${s}%,email.ilike.%${s}%`);
  }
  const { data } = await query;
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Contactos" sub={`${rows.length} ${q ? "resultados" : "contactos"}`}
        action={<Link href="/contactos/nuevo" className="btn-primary">+ Nuevo</Link>} />
      <form className="mb-4">
        <input className="input" name="q" defaultValue={q} placeholder="Buscar por nombre, teléfono, dirección o ZIP" type="search" />
      </form>
      {rows.length === 0 ? <Empty>No hay contactos{q ? " con esa búsqueda" : ""}.</Empty> : (
        <ul className="card divide-y divide-gray-100">
          {rows.map((c: any) => (
            <li key={c.id} className="flex items-center gap-3 p-3">
              <Link href={`/contactos/${c.id}`} className="min-w-0 flex-1">
                <div className="font-semibold truncate">{fullName(c)}</div>
                <div className="muted truncate">{[c.address, c.city, c.zip].filter(Boolean).join(", ") || sourceLabel(c.source)}</div>
                <div className="text-xs text-gray-400">{c.jobs?.[0]?.count ?? 0} trabajo(s) · {sourceLabel(c.source)}</div>
              </Link>
              {c.phone && <a href={telHref(c.phone)} className="btn-secondary px-3 shrink-0">Llamar</a>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
