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
    { href: "/tareas", label: "Mis tareas", icon: "tasks" },
  ] },
  { title: "Ventas & CRM", items: [
    { href: "/trabajos", label: "Trabajos", icon: "jobs", hint: "Leads, seguro, vendidos y producción" },
    { href: "/contactos", label: "Contactos", icon: "contacts" },
    { href: "/rendimiento", label: "Rendimiento de ventas", icon: "trophy", hint: "Ranking, metas y comisiones" },
  ] },
  { title: "Operaciones en campo", items: [
    { href: "/mapa", label: "Mapa", icon: "pin" },
    { href: "/territorios", label: "Calles / Door-to-door", icon: "streets" },
    { href: "/tormentas", label: "Tormentas (granizo)", icon: "storm" },
  ] },
  { title: "Administración", items: [
    { href: "/usuarios", label: "Usuarios", icon: "users", admin: true },
    { href: "/importar", label: "Importar Trello", icon: "import", admin: true },
  ] },
];

export type ShellUser = { name: string; role: string; isAdmin: boolean; alerts: number; tasks: number };

export const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
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
function Badge({ n }: { n: number }) {
  return n > 0 ? <span className="ml-auto min-w-[20px] rounded-full bg-brand px-1.5 text-center text-[11px] font-semibold leading-5 text-white tnum">{n > 99 ? "99+" : n}</span> : null;
}

export function DesktopSidebar({ user }: { user: ShellUser }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("ttr-sidebar") === "1");
      setClosed(JSON.parse(localStorage.getItem("ttr-sidebar-groups") ?? "{}"));
    } catch {}
  }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("ttr-sidebar", c ? "0" : "1"); } catch {} return !c; });
  const toggleGroup = (t: string) => setClosed((c) => { const n = { ...c, [t]: !c[t] }; try { localStorage.setItem("ttr-sidebar-groups", JSON.stringify(n)); } catch {} return n; });
  const badgeFor = (href: string) => (href === "/tareas" ? user.tasks : href === "/tormentas" ? user.alerts : 0);

  return (
    <aside className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen bg-night text-white/80 transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-64"}`} aria-label="Navegación principal">
      <div className={`flex items-center h-20 ${collapsed ? "justify-center px-2" : "px-5"}`}>
        <Link href="/" className="flex items-center gap-3 min-w-0" aria-label="Texas Top Roofing CRM – Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-light.png" alt="" width={256} height={252} className={`object-contain shrink-0 ${collapsed ? "w-10 h-10" : "w-12 h-12"}`} />
          {!collapsed && (
            <span className="leading-none min-w-0">
              <span className="block text-[17px] font-bold tracking-wide text-white">TEXAS <span className="text-brand">TOP</span></span>
              <span className="block text-[17px] font-bold tracking-wide text-white">ROOFING</span>
              <span className="block mt-0.5 text-[11px] tracking-[0.3em] text-white/50">CRM</span>
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
        {groupsFor(user.isAdmin).map((g, gi) => {
          const shut = !!closed[g.title] && !collapsed;
          return (
            <div key={g.title}>
              {gi > 0 && !collapsed && (
                <button type="button" onClick={() => toggleGroup(g.title)} aria-expanded={!shut}
                  className="w-full flex items-center justify-between px-2.5 mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45 hover:text-white/70">
                  {g.title}<Icon name="chevronDown" className={`w-3.5 h-3.5 transition ${shut ? "-rotate-90" : ""}`} />
                </button>
              )}
              {gi > 0 && collapsed && <div className="mx-2 mb-2 border-t border-white/10" aria-hidden />}
              {!shut && (
                <ul className="space-y-0.5">
                  {g.items.map((i) => {
                    const on = isActive(path, i.href);
                    const b = badgeFor(i.href);
                    return (
                      <li key={i.href}>
                        <Link href={i.href} title={collapsed ? i.label : i.hint} aria-current={on ? "page" : undefined}
                          className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition ${collapsed ? "justify-center" : ""} ${on ? "bg-brand text-white shadow-sm" : "text-white/75 hover:bg-white/5 hover:text-white"}`}>
                          <Icon name={i.icon} className="w-5 h-5 shrink-0" />
                          {!collapsed && <span className="truncate">{i.label}</span>}
                          {!collapsed && !on && <Badge n={b} />}
                          {collapsed && b > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-brand" aria-hidden />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button type="button" onClick={toggle} className={`w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white ${collapsed ? "justify-center" : ""}`}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"} title={collapsed ? "Expandir menú" : "Contraer menú"}>
          <Icon name="sidebar" className="w-5 h-5" />{!collapsed && "Contraer menú"}
        </button>
      </div>
    </aside>
  );
}

// Barra superior de escritorio: búsqueda global, alertas, nuevo y perfil
export function DesktopTopBar({ user }: { user: ShellUser }) {
  const [menu, setMenu] = useState(false);
  const [quick, setQuick] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  return (
    <div className="hidden lg:flex sticky top-0 z-40 h-16 items-center gap-4 border-b border-line bg-white/90 backdrop-blur px-8">
      <form action="/buscar" className="relative w-full max-w-md" role="search">
        <Icon name="search" className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input name="q" type="search" placeholder="Buscar leads, clientes, direcciones…" aria-label="Buscar en el CRM"
          className="w-full rounded-lg border border-line bg-canvas pl-9 pr-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand focus:bg-white" />
      </form>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => setQuick(true)} className="btn-primary btn-sm min-h-[40px]"><Icon name="plus" className="w-4 h-4" />Nuevo</button>
        <Link href="/tormentas?tab=alertas" className="relative btn-ghost px-2.5 min-h-[40px]" aria-label={user.alerts ? `${user.alerts} alertas de granizo nuevas` : "Alertas de granizo"}>
          <Icon name="bell" />
          {user.alerts > 0 && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-white" aria-hidden />}
        </Link>
        <div ref={ref} className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-canvas">
            <Avatar name={user.name} className="w-9 h-9 text-sm" />
            <span className="text-left leading-tight">
              <span className="block text-sm font-semibold">{user.name}</span>
              <span className="block text-xs text-muted">{user.role}</span>
            </span>
            <Icon name="chevronDown" className="w-4 h-4 text-muted" />
          </button>
          {menu && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-white border border-line shadow-pop p-2 z-50">
              <ProfileActions user={user} onPick={() => setMenu(false)} />
            </div>
          )}
        </div>
      </div>
      <BottomSheet open={quick} onClose={() => setQuick(false)} title="Crear">
        <QuickList onPick={() => setQuick(false)} />
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------
// Móvil: encabezado compacto + barra inferior + hojas
// ---------------------------------------------------------------------
export function MobileHeader({ user }: { user: ShellUser }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <header className="lg:hidden sticky top-0 z-[1000] bg-night text-white pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgba(255,255,255,.06)]">
      <div className="h-14 px-2 flex items-center justify-between gap-1">
        <button type="button" onClick={() => setMenu(true)} className="btn px-2.5 min-h-[44px] text-white hover:bg-white/10" aria-label="Abrir menú"><Icon name="menu" className="w-6 h-6" /></button>
        <Link href="/" className="flex items-center gap-2 min-w-0 mr-auto" aria-label="Texas Top Roofing CRM – Inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark-light.png" alt="" width={256} height={252} className="w-9 h-9 object-contain" />
          <span className="leading-none">
            <span className="block text-[14px] font-bold tracking-wide text-white">TEXAS <span className="text-brand">TOP</span></span>
            <span className="block text-[14px] font-bold tracking-wide text-white">ROOFING <span className="text-[10px] font-medium tracking-[0.2em] text-white/50">CRM</span></span>
          </span>
        </Link>
        <Link href="/tormentas?tab=alertas" className="relative btn px-2.5 min-h-[44px] text-white hover:bg-white/10" aria-label={user.alerts ? `${user.alerts} alertas de granizo nuevas` : "Alertas de granizo"}>
          <Icon name="bell" className="w-6 h-6" />
          {user.alerts > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-night" aria-hidden />}
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="p-1.5 rounded-full" aria-label="Perfil y sesión">
          <Avatar name={user.name} className="w-9 h-9 text-xs ring-2 ring-white/20" />
        </button>
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Tu cuenta">
        <ProfileActions user={user} onPick={() => setOpen(false)} />
      </BottomSheet>
      <BottomSheet open={menu} onClose={() => setMenu(false)} title="Menú">
        <MenuGrid user={user} path={path} onPick={() => setMenu(false)} />
      </BottomSheet>
    </header>
  );
}

const MENU_TONE: Record<string, string> = {
  "/": "bg-brand-soft text-brand", "/calendario": "bg-sky-50 text-sky-600", "/tareas": "bg-green-50 text-green-600",
  "/trabajos": "bg-night text-white", "/contactos": "bg-violet-50 text-violet-600", "/rendimiento": "bg-amber-50 text-amber-600", "/mapa": "bg-brand-soft text-brand",
  "/territorios": "bg-amber-50 text-amber-600", "/tormentas": "bg-sky-50 text-sky-700", "/usuarios": "bg-canvas text-ink/70", "/importar": "bg-canvas text-ink/70",
};

function MenuGrid({ user, path, onPick }: { user: ShellUser; path: string; onPick: () => void }) {
  return (
    <div className="space-y-4 pb-2">
      <form action="/buscar" className="relative" role="search" onSubmit={onPick}>
        <Icon name="search" className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input name="q" type="search" placeholder="Buscar leads, clientes, direcciones…" aria-label="Buscar en el CRM" className="input pl-9" />
      </form>
      {groupsFor(user.isAdmin).map((g) => (
        <div key={g.title}>
          <div className="eyebrow mb-1.5">{g.title}</div>
          <ul className="grid grid-cols-3 gap-2">
            {g.items.map((i) => {
              const on = isActive(path, i.href);
              const b = i.href === "/tareas" ? user.tasks : i.href === "/tormentas" ? user.alerts : 0;
              return (
                <li key={i.href}>
                  <Link href={i.href} onClick={onPick} aria-current={on ? "page" : undefined}
                    className={`relative flex h-full flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-[12px] font-medium leading-tight ${on ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-canvas"}`}>
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${on ? "bg-brand text-white" : MENU_TONE[i.href] ?? "bg-canvas text-ink/70"}`}><Icon name={i.icon} className="w-5 h-5" /></span>{i.label}
                    {b > 0 && <span className="absolute top-1.5 right-1.5 rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{b}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

const TABS: Item[] = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/trabajos", label: "Trabajos", icon: "jobs" },
  { href: "/mapa", label: "Mapa", icon: "pin" },
];

export function BottomNav({ user }: { user: ShellUser }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  const inMore = !TABS.some((t) => isActive(path, t.href));
  return (
    <>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-[1000] bg-white border-t border-line pb-[env(safe-area-inset-bottom)]" aria-label="Navegación">
        <div className="grid grid-cols-4">
          {TABS.map((t) => {
            const on = isActive(path, t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[58px] text-[12px] font-medium ${on ? "text-brand" : "text-muted"}`}>
                <span className={`flex items-center justify-center w-14 h-8 rounded-full transition ${on ? "bg-brand-soft" : ""}`}><Icon name={t.icon} className="w-6 h-6" strokeWidth={on ? 2 : 1.75} /></span>{t.label}
              </Link>
            );
          })}
          <button type="button" onClick={() => setMore(true)} aria-expanded={more}
            className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[58px] text-[12px] font-medium ${inMore ? "text-brand" : "text-muted"}`}>
            <span className={`flex items-center justify-center w-14 h-8 rounded-full transition ${inMore ? "bg-brand-soft" : ""}`}><Icon name="grid" className="w-6 h-6" strokeWidth={inMore ? 2 : 1.75} /></span>Más
            {user.tasks + user.alerts > 0 && <span className="absolute top-2 left-1/2 ml-2 w-2 h-2 rounded-full bg-brand" aria-hidden />}
          </button>
        </div>
      </nav>
      <BottomSheet open={more} onClose={() => setMore(false)} title="Más">
        <MenuGrid user={user} path={path} onPick={() => setMore(false)} />
        <div className="border-t border-line mt-2 pt-3 pb-1"><ProfileActions user={user} onPick={() => setMore(false)} /></div>
      </BottomSheet>
    </>
  );
}

// Acciones rápidas en una tarjeta (Inicio, móvil)
export function QuickButtons() {
  const items = [
    { href: "/trabajos/nuevo", icon: "plus", l: "Lead", c: "bg-brand text-white" },
    { href: "/calendario?nueva=otra", icon: "calendar", l: "Cita", c: "bg-sky-500 text-white" },
    { href: "/calendario?nueva=inspeccion", icon: "camera", l: "Inspección", c: "bg-violet-500 text-white" },
    { href: "/territorios", icon: "door", l: "Visita", c: "bg-amber-500 text-white" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((a) => (
        <Link key={a.l} href={a.href} className="card flex flex-col items-center gap-1 py-3 text-xs font-medium active:bg-canvas">
          <span className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm ${a.c}`}><Icon name={a.icon} className="w-5 h-5" strokeWidth={2} /></span>{a.l}
        </Link>
      ))}
    </div>
  );
}
