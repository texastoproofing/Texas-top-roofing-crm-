import { getSession } from "@/lib/auth";
import { roleLabel } from "@/lib/constants";
import { displayName } from "@/lib/format";
import { BottomNav, DesktopSidebar, DesktopTopBar, MobileHeader, type ShellUser } from "@/components/Nav";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile } = await getSession();
  const [{ count }, { count: tasks }] = await Promise.all([
    supabase.from("storm_alerts").select("id", { count: "exact", head: true }).eq("status", "nueva"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("done", false).eq("assigned_to", profile.id),
  ]);
  const user: ShellUser = {
    name: displayName(profile.full_name), role: roleLabel(profile.role),
    isAdmin: profile.role === "administrador", alerts: count ?? 0, tasks: tasks ?? 0,
  };
  return (
    <div className="min-h-screen lg:flex">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[2000] btn-dark">Saltar al contenido</a>
      <DesktopSidebar user={user} />
      <div className="flex-1 min-w-0">
        <MobileHeader user={user} />
        <DesktopTopBar user={user} />
        <main id="contenido" className="px-4 py-4 sm:py-5 lg:px-8 lg:py-8 pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-10 max-w-[1280px] mx-auto">{children}</main>
      </div>
      <BottomNav user={user} />
    </div>
  );
}
