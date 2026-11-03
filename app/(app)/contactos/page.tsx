import Link from "next/link";
import { getSession } from "@/lib/auth";
import { sourceLabel } from "@/lib/constants";
import { fullName, telHref } from "@/lib/format";
import { Empty, PageHeader } from "@/components/ui";
import { Icon } from "@/components/icons";

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

  const sms = (p: string) => "sms:" + p.replace(/[^\d+]/g, "");
  return (
    <>
      <PageHeader title="Contactos" sub={`${rows.length} ${q ? "resultados" : "contactos"}`}
        action={<Link href="/contactos/nuevo" className="btn-primary"><Icon name="plus" className="w-4 h-4" /><span className="hidden sm:inline">Nuevo contacto</span></Link>} />
      <form className="relative mb-4">
        <Icon name="search" className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input className="input pl-9" name="q" defaultValue={q} placeholder="Buscar por nombre, teléfono, dirección o ZIP" type="search" aria-label="Buscar contactos" />
      </form>
      {rows.length === 0 ? <Empty icon="contacts">No hay contactos{q ? " con esa búsqueda" : ""}.</Empty> : (
        <>
          <div className="hidden md:block card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nombre</th>
                  <th className="px-4 py-2.5 font-medium">Dirección</th>
                  <th className="px-4 py-2.5 font-medium">Teléfono</th>
                  <th className="px-4 py-2.5 font-medium">Origen</th>
                  <th className="px-4 py-2.5 font-medium text-right">Trabajos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {rows.map((c: any) => (
                  <tr key={c.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-2.5 font-medium"><Link href={`/contactos/${c.id}`}>{fullName(c)}</Link></td>
                    <td className="px-4 py-2.5 text-ink/80 max-w-[320px] truncate">{[c.address, c.city, c.zip].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-4 py-2.5">{c.phone ? <a className="text-brand font-medium" href={telHref(c.phone)}>{c.phone}</a> : "—"}</td>
                    <td className="px-4 py-2.5 text-muted">{sourceLabel(c.source)}</td>
                    <td className="px-4 py-2.5 text-right tnum">{c.jobs?.[0]?.count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden space-y-2">
            {rows.map((c: any) => (
              <li key={c.id} className="card p-3">
                <Link href={`/contactos/${c.id}`} className="block">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{fullName(c)}</span>
                    <span className="text-xs text-muted shrink-0">{c.jobs?.[0]?.count ?? 0} trabajo(s)</span>
                  </div>
                  <div className="text-xs text-muted truncate">{[c.address, c.city, c.zip].filter(Boolean).join(", ") || sourceLabel(c.source)}</div>
                </Link>
                {c.phone && (
                  <div className="grid grid-cols-3 gap-2 mt-2.5">
                    <a href={telHref(c.phone)} className="btn-secondary btn-sm"><Icon name="phone" className="w-4 h-4" />Llamar</a>
                    <a href={sms(c.phone)} className="btn-secondary btn-sm"><Icon name="message" className="w-4 h-4" />Mensaje</a>
                    <Link href={`/contactos/${c.id}`} className="btn-secondary btn-sm">Abrir</Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
