"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { logout } from "@/app/login/actions";

export { Icon };

// ---------------------------------------------------------------------
// Menú: solo rutas que existen. Etiquetas conocidas por el equipo.
// ---------------------------------------------------------------------
type Item = { href: string; label: string; icon: string; admin?: boolean; hint?: string };
type Group = { title: string; items: Item[] };
export const NAV: Group[] = [
  { title: "General", items: [
    { href: "/", label: "Inicio", icon: "home" },
    { href: "/calendario", label: "Agenda", icon: "calendar" },
    { href: "/tareas", label: "Tareas", icon: "tasks" },
  ] },
  { title: "Ventas", items: [
    { href: "/trabajos", label: "Trabajos", icon: "jobs", hint: "Leads, seguro, vendidos y producción" },
    { href: "/contactos", label: "Contactos", icon: "contacts" },
  ] },
  { title: "Campo", items: [
    { href: "/mapa", label: "Mapa", icon: "pin" },
    { href: "/territorios", label: "Calles", icon: "streets", hint: "Door-to-door" },
    { href: "/tormentas", label: "Tormentas", icon: "storm", hint: "Granizo y viento" },
  ] },
  { title: "Administración", items: [
    { href: "/usuarios", label: "Usuarios", icon: "users", admin: true },
    { href: "/importar", label: "Importar Trello", icon: "import", admin: true },
  ] },
];

export type ShellUser = { name: string; role: string; isAdmin: boolean; alerts: number };

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
const groupsFor = (isAdmin: boolean) => NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.admin || isAdmin) })).filter((g) => g.items.length);
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

function Avatar({ name, className = "w-8 h-8 text-xs" }: { name: string; className?: string }) {
  return <span className={`inline-flex items-center justify-center rounded-full bg-brand text-white font-semibold shrink-0 ${className}`} aria-hidden>{initials(name)}</span>;
}

// ---------------------------------------------------------------------
// Hoja inferior (móvil) / diálogo (escritorio)
// ---------------------------------------------------------------------
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const ov = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ov; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-night/50 animate-[fade_.15s_ease-out]" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-pop outline-none max-h-[85vh] overflow-y-auto pb-[max(16px,env(safe-area-inset-bottom))] animate-[sheet_.2s_ease-out]">
        <div className="sm:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-line" aria-hidden />
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="h2">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm px-2" aria-label="Cerrar"><Icon name="x" /></button>
        </div>
        <div className="px-4">{children}</div>
      </div>
    </div>
  );
}

// Acciones rápidas (todas llevan a flujos que ya existen)
const QUICK: { href: string; label: string; icon: string; desc: string }[] = [
  { href: "/trabajos/nuevo", label: "Nuevo lead", icon: "plus", desc: "Cliente y trabajo nuevos" },
  { href: "/calendario?nueva=inspeccion", label: "Nueva inspección", icon: "calendar", desc: "Cita de inspección" },
  { href: "/calendario?nueva=otra", label: "Nueva cita", icon: "clock", desc: "Reunión, recorrido, firma…" },
  { href: "/tareas?nueva=1", label: "Nueva tarea", icon: "tasks", desc: "Para ti o el equipo" },
  { href: "/territorios", label: "Registrar visita", icon: "door", desc: "Puertas tocadas en una calle" },
  { href: "/contactos/nuevo", label: "Nuevo contacto", icon: "contacts", desc: "Sin crear trabajo todavía" },
];
function QuickList({ onPick }: { onPick: () => void }) {
  return (
    <ul className="grid grid-cols-2 gap-2 pb-2">
      {QUICK.map((q) => (
        <li key={q.href}>
          <Link href={q.href} onClick={onPick} className="flex h-full flex-col gap-1 rounded-xl border border-line p-3 hover:bg-canvas active:bg-canvas">
            <span className="w-8 h-8 rounded-lg bg-brand-soft text-brand flex items-center justify-center"><Icon name={q.icon} className="w-4 h-4" /></span>
            <span className="text-sm font-semibold">{q.label}</span>
            <span className="text-xs text-muted leading-snug">{q.desc}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProfileActions({ user, onPick }: { user: ShellUser; onPick?: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 rounded-xl bg-canvas p-3">
        <Avatar name={user.name} className="w-10 h-10 text-sm" />
        <div className="min-w-0">
          <div className="font-semibold truncate">{user.name}</div>
          <div className="text-xs text-muted">{user.role}</div>
        </div>
      </div>
      <Link href="/auth/set-password" onClick={onPick} className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-canvas text-sm font-medium">
        <Icon name="key" className="w-5 h-5 text-muted" />Cambiar contraseña
      </Link>
      <form action={logout}>
        <button className="w-full flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-canvas text-sm font-medium text-brand">
          <Icon name="logout" className="w-5 h-5" />Cerrar sesión
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Escritorio: barra lateral oscura y contraíble
// ---------------------------------------------------------------------
export function DesktopSidebar({ user }: { user: ShellUser }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [quick, setQuick] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => { try { setCollapsed(localStorage.getItem("ttr-sidebar") === "1"); } catch {} }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("ttr-sidebar", c ? "0" : "1"); } catch {} return !c; });

  return (
    <aside className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen bg-night text-white/80 transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-64"}`} aria-label="Navegación principal">
      <div className={`flex items-center gap-2 h-16 border-b border-white/10 ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <Link href="/" className="flex items-center gap-2.5 min-w-0" aria-label="Texas Top Roofing CRM – Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-light.png" alt="" width={256} height={252} className="w-9 h-9 object-contain shrink-0" />
          {!collapsed && (
            <span className="leading-tight min-w-0">
              <span className="block text-[13px] font-semibold tracking-wide text-white">Texas <span className="text-brand">Top</span> Roofing</span>
              <span className="block text-[11px] text-white/50">CRM</span>
            </span>
          )}
        </Link>
      </div>

      <div className={`pt-3 ${collapsed ? "px-3" : "px-3"}`}>
        <button type="button" onClick={() => setQuick(true)} title="Nuevo"
          className={`btn-primary w-full ${collapsed ? "px-0" : ""}`}><Icon name="plus" className="w-4 h-4" />{!collapsed && "Nuevo"}</button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groupsFor(user.isAdmin).map((g) => (
          <div key={g.title}>
            {!collapsed && <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/40">{g.title}</div>}
            {collapsed && <div className="mx-2 mb-1 border-t border-white/10" aria-hidden />}
            <ul className="space-y-0.5">
              {g.items.map((i) => {
                const on = isActive(path, i.href);
                return (
                  <li key={i.href}>
                    <Link href={i.href} title={collapsed ? i.label : i.hint} aria-current={on ? "page" : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition ${collapsed ? "justify-center" : ""} ${on ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white"}`}>
                      {on && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-brand" aria-hidden />}
                      <Icon name={i.icon} className={`w-5 h-5 shrink-0 ${on ? "text-white" : "text-white/60 group-hover:text-white"}`} />
                      {!collapsed && <span className="truncate">{i.label}</span>}
                      {!collapsed && i.href === "/tormentas" && user.alerts > 0 && (
                        <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white tnum">{user.alerts}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3 space-y-1 relative">
        <button type="button" onClick={toggle} className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white ${collapsed ? "justify-center" : ""}`}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"} title={collapsed ? "Expandir menú" : "Contraer menú"}>
          <Icon name="sidebar" className="w-5 h-5" />{!collapsed && "Contraer"}
        </button>
        <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu}
          className={`w-full flex items-center gap-3 rounded-lg p-2 hover:bg-white/5 text-left ${collapsed ? "justify-center" : ""}`}>
          <Avatar name={user.name} />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-white truncate">{user.name}</span>
              <span className="block text-xs text-white/50">{user.role}</span>
            </span>
          )}
          {!collapsed && <Icon name="chevronDown" className="w-4 h-4 text-white/50" />}
        </button>
        {menu && (
          <div className="absolute bottom-full left-3 mb-2 w-60 rounded-xl bg-white text-ink shadow-pop p-2 z-50">
            <ProfileActions user={user} onPick={() => setMenu(false)} />
          </div>
        )}
      </div>
      <BottomSheet open={quick} onClose={() => setQuick(false)} title="Crear">
        <QuickList onPick={() => setQuick(false)} />
      </BottomSheet>
    </aside>
  );
}

// ---------------------------------------------------------------------
// Móvil: encabezado compacto + barra inferior + hojas
// ---------------------------------------------------------------------
export function MobileHeader({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="lg:hidden sticky top-0 z-[1000] bg-white/95 backdrop-blur border-b border-line pt-[env(safe-area-inset-top)]">
      <div className="h-14 px-4 flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center gap-2 min-w-0" aria-label="Texas Top Roofing CRM – Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" width={256} height={252} className="w-8 h-8 object-contain" />
          <span className="text-[15px] font-semibold tracking-tight">Texas <span className="text-brand">Top</span> Roofing</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link href="/tormentas?tab=alertas" className="relative btn-ghost px-2.5 min-h-[40px]" aria-label={user.alerts ? `${user.alerts} alertas de granizo nuevas` : "Alertas de granizo"}>
            <Icon name="bell" />
            {user.alerts > 0 && <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-[10px] font-semibold text-white flex items-center justify-center tnum">{user.alerts > 9 ? "9+" : user.alerts}</span>}
          </Link>
          <button type="button" onClick={() => setOpen(true)} className="p-1 rounded-full" aria-label="Perfil y sesión">
            <Avatar name={user.name} />
          </button>
        </div>
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Tu cuenta">
        <ProfileActions user={user} onPick={() => setOpen(false)} />
      </BottomSheet>
    </header>
  );
}

const TABS: Item[] = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/trabajos", label: "Trabajos", icon: "jobs" },
  { href: "/mapa", label: "Mapa", icon: "pin" },
  { href: "/territorios", label: "Calles", icon: "streets" },
];

export function BottomNav({ user }: { user: ShellUser }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const inMore = !TABS.some((t) => isActive(path, t.href));
  const tab = (t: Item) => {
    const on = isActive(path, t.href);
    return (
      <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
        className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${on ? "text-brand" : "text-muted"}`}>
        <Icon name={t.icon} className="w-6 h-6" strokeWidth={on ? 2 : 1.75} />{t.label}
      </Link>
    );
  };
  const others = groupsFor(user.isAdmin).flatMap((g) => g.items).filter((i) => !TABS.some((t) => t.href === i.href));
  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-[1000] bg-white border-t border-line pb-[env(safe-area-inset-bottom)]" aria-label="Navegación">
        <div className="grid grid-cols-6 items-center">
          {tab(TABS[0])}{tab(TABS[1])}
          <div className="flex items-center justify-center">
            <button type="button" onClick={() => setQuick(true)} aria-label="Crear: lead, cita, tarea o visita"
              className="w-12 h-12 -mt-1 rounded-2xl bg-brand text-white shadow-pop flex items-center justify-center active:scale-95 transition">
              <Icon name="plus" className="w-6 h-6" strokeWidth={2.25} />
            </button>
          </div>
          {tab(TABS[2])}{tab(TABS[3])}
          <button type="button" onClick={() => setMore(true)} aria-expanded={more}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${inMore ? "text-brand" : "text-muted"}`}>
            <Icon name="grid" className="w-6 h-6" />Más
          </button>
        </div>
      </nav>
      <BottomSheet open={more} onClose={() => setMore(false)} title="Más">
        <ul className="grid grid-cols-3 gap-2 pb-3">
          {others.map((i) => (
            <li key={i.href}>
              <Link href={i.href} onClick={() => setMore(false)} aria-current={isActive(path, i.href) ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-[13px] font-medium ${isActive(path, i.href) ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-canvas"}`}>
                <Icon name={i.icon} className="w-6 h-6" />{i.label}
                {i.href === "/tormentas" && user.alerts > 0 && <span className="absolute top-1.5 right-1.5 rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{user.alerts}</span>}
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-line pt-3 pb-1"><ProfileActions user={user} onPick={() => setMore(false)} /></div>
      </BottomSheet>
      <BottomSheet open={quick} onClose={() => setQuick(false)} title="Crear">
        <QuickList onPick={() => setQuick(false)} />
      </BottomSheet>
    </>
  );
}
