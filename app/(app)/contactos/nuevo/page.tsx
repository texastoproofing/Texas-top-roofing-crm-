import { getSession, listProfiles } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ContactFields } from "@/components/ContactForm";
import { createContact } from "../actions";

export default async function NewContact() {
  const { supabase } = await getSession();
  const [users, terr] = await Promise.all([
    listProfiles(),
    supabase.from("territories").select("id, code, name").order("priority"),
  ]);
  return (
    <>
      <PageHeader title="Nuevo contacto" />
      <form action={createContact} className="card p-4 space-y-5">
        <ContactFields users={users.filter((u) => u.active)} territories={terr.data ?? []} />
        <button className="btn-primary w-full sm:w-auto">Guardar contacto</button>
      </form>
    </>
  );
}
