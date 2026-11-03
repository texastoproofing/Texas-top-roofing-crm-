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
        <Link href="/" className="block text-center" aria-label="Texas Top Roofing CRM – Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Texas Top Roofing" width={656} height={508} className="mx-auto w-36 h-auto" />
          <div className="mt-1 text-xs font-bold uppercase tracking-[0.3em] text-gray-500">CRM</div>
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
          <Link href="/" className="flex items-center gap-2" aria-label="Texas Top Roofing CRM – Inicio">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" width={256} height={252} className="w-9 h-9 object-contain" />
            <span className="leading-tight">
              <span className="block text-[11px] font-bold tracking-wider">TEXAS <span className="text-brand">TOP</span> ROOFING</span>
              <span className="block text-[10px] font-semibold tracking-[0.25em] text-gray-500">CRM</span>
            </span>
          </Link>
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
