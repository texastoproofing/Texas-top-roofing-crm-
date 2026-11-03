"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v10h13V10",
  jobs: "M4 6h16M4 12h16M4 18h10",
  contacts: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  calendar: "M4 7h16v13H4zM4 11h16M8 4v4M16 4v4",
  tasks: "m5 12 4 4 10-10",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14",
  pin: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9a6 6 0 0 1 12 0m2-9a3 3 0 1 0 0-6m1.5 15H22a5 5 0 0 0-4-4.9",
  import: "M12 4v11m0 0-4-4m4 4 4-4M5 20h14",
};

export function Icon({ name, className = "w-5 h-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

type Item = { href: string; label: string; icon: string; admin?: boolean; mobile?: boolean };
const ITEMS: Item[] = [
  { href: "/", label: "Inicio", icon: "home", mobile: true },
  { href: "/trabajos", label: "Trabajos", icon: "jobs", mobile: true },
  { href: "/mapa", label: "Mapa", icon: "pin", mobile: true },
  { href: "/contactos", label: "Contactos", icon: "contacts", mobile: true },
  { href: "/calendario", label: "Agenda", icon: "calendar", mobile: true },
  { href: "/territorios", label: "Calles", icon: "map", mobile: true },
  { href: "/tareas", label: "Tareas", icon: "tasks" },
  { href: "/usuarios", label: "Usuarios", icon: "users", admin: true },
  { href: "/importar", label: "Importar Trello", icon: "import", admin: true },
];

function active(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
}

export function SideNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {ITEMS.filter((i) => !i.admin || isAdmin).map((i) => (
        <Link key={i.href} href={i.href}
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${active(path, i.href) ? "bg-brand-soft text-brand" : "text-gray-700 hover:bg-gray-100"}`}>
          <Icon name={i.icon} />{i.label}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
      {ITEMS.filter((i) => i.mobile).map((i) => (
        <Link key={i.href} href={i.href}
          className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${active(path, i.href) ? "text-brand" : "text-gray-500"}`}>
          <Icon name={i.icon} className="w-6 h-6" />{i.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileMenu({ isAdmin }: { isAdmin: boolean }) {
  return (
    <details className="relative lg:hidden">
      <summary className="list-none btn-ghost px-3 cursor-pointer">Menú</summary>
      <div className="absolute right-0 mt-2 w-56 card p-2 shadow-lg z-40">
        <SideNav isAdmin={isAdmin} />
      </div>
    </details>
  );
}
