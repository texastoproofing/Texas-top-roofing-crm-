import Link from "next/link";
import { getSession } from "@/lib/auth";
import { roleLabel } from "@/lib/constants";
import { BottomNav, MobileMenu, SideNav } from "@/components/Nav";
import { logout } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await getSession();
  const isAdmin = profile.role === "administrador";
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 border-r border-gray-200 bg-white p-4 gap-6 sticky top-0 h-screen">
        <Link href="/" className="block">
          <div className="text-xs font-bold uppercase tracking-widest text-brand">Texas Top Roofing</div>
          <div className="text-xl font-bold">CRM</div>
        </Link>
        <SideNav isAdmin={isAdmin} />
        <div className="mt-auto text-sm">
          <div className="font-semibold">{profile.full_name}</div>
          <div className="muted">{roleLabel(profile.role)}</div>
          <div className="flex gap-3 mt-2">
            <Link href="/auth/set-password" className="text-gray-600 font-semibold">Contraseña</Link>
            <form action={logout}><button className="text-brand font-semibold">Cerrar sesión</button></form>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="lg:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 px-4 h-14 flex items-center justify-between">
          <Link href="/" className="font-bold"><span className="text-brand">TTR</span> CRM</Link>
          <div className="flex items-center gap-1">
            <MobileMenu isAdmin={isAdmin} />
            <form action={logout}><button className="btn-ghost px-3">Salir</button></form>
          </div>
        </header>
        <main className="px-4 py-5 lg:px-8 lg:py-8 pb-28 lg:pb-8 max-w-6xl mx-auto">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
