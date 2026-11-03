import { requireAdmin } from "@/lib/auth";
import { HailpointReceiver } from "./HailpointReceiver";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ImportarHailPointPage() {
  await requireAdmin();
  return <HailpointReceiver />;
}
