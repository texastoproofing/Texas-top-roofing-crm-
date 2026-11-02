import { requireAdmin, listProfiles } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { Importer } from "./Importer";

export default async function ImportPage() {
  const { profile } = await requireAdmin();
  const users = (await listProfiles()).filter((u) => u.active);
  return (
    <>
      <PageHeader title="Importar desde Trello" sub="Pasa los clientes del tablero TEXAS TOP ROOFING al CRM" />
      <Importer users={users} me={profile.id} />
    </>
  );
}
