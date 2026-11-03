import Link from "next/link";
import { statusInfo, type StageKey } from "@/lib/constants";
import { Icon } from "./icons";

// Color por etapa del pipeline (solo presentación; los estados no cambian)
export const STAGE_TONE: Record<StageKey, { dot: string; bg: string; text: string; bar: string }> = {
  lead: { dot: "bg-sky-500", bg: "bg-sky-50", text: "text-sky-800", bar: "bg-sky-500" },
  seguro: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-800", bar: "bg-amber-500" },
  vendido: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-800", bar: "bg-emerald-500" },
  produccion: { dot: "bg-violet-500", bg: "bg-violet-50", text: "text-violet-800", bar: "bg-violet-500" },
  cobro: { dot: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-800", bar: "bg-orange-500" },
  completado: { dot: "bg-green-600", bg: "bg-green-50", text: "text-green-800", bar: "bg-green-600" },
  perdido: { dot: "bg-gray-400", bg: "bg-gray-100", text: "text-gray-600", bar: "bg-gray-400" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = statusInfo(status);
  const t = STAGE_TONE[s.stage] ?? STAGE_TONE.lead;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${t.bg} ${t.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} aria-hidden />{s.label}
    </span>
  );
}

export function PageHeader({ title, sub, action, back }: { title: string; sub?: string; action?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink mb-1">
          <Icon name="chevronLeft" className="w-4 h-4" />{back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h1">{title}</h1>
          {sub && <p className="muted mt-0.5">{sub}</p>}
        </div>
        {action && <div className="flex shrink-0 gap-2">{action}</div>}
      </div>
    </div>
  );
}

// Tarjeta de sección con título y acción opcional
export function Section({ title, action, children, className = "", bodyClass = "p-4" }: {
  title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
          {title && <h2 className="h2">{title}</h2>}
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Field({ label, name, type = "text", defaultValue, required, placeholder, step, inputMode, autoComplete }: {
  label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean;
  placeholder?: string; step?: string; inputMode?: "numeric" | "decimal" | "tel" | "email" | "text"; autoComplete?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{required && <span className="text-brand"> *</span>}</label>
      <input className="input" id={name} name={name} type={type} defaultValue={defaultValue ?? ""} required={required}
        placeholder={placeholder} step={step} inputMode={inputMode ?? (type === "tel" ? "tel" : type === "email" ? "email" : undefined)} autoComplete={autoComplete} />
    </div>
  );
}

export function Select({ label, name, options, defaultValue, required, empty }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string | null;
  required?: boolean; empty?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{required && <span className="text-brand"> *</span>}</label>
      <select className="input" id={name} name={name} defaultValue={defaultValue ?? ""} required={required}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function TextArea({ label, name, defaultValue, rows = 3 }: { label: string; name: string; defaultValue?: string | null; rows?: number }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <textarea className="input" id={name} name={name} rows={rows} defaultValue={defaultValue ?? ""} />
    </div>
  );
}

// Estado vacío compacto y útil
export function Empty({ children, icon = "inbox", action }: { children: React.ReactNode; icon?: string; action?: React.ReactNode }) {
  return (
    <div className="card px-4 py-6 text-center">
      <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-canvas flex items-center justify-center text-muted"><Icon name={icon} /></div>
      <div className="muted">{children}</div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
export function EmptyInline({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">
      <span>{children}</span>{action}
    </div>
  );
}

// KPI con valor real, icono y enlace al detalle
export function Stat({ label, value, href, icon, hint, tone = "default" }: {
  label: string; value: string | number; href?: string; icon?: string; hint?: string; tone?: "default" | "brand" | "dark";
}) {
  const dark = tone === "dark";
  const inner = (
    <div className={`${dark ? "rounded-xl bg-night text-white p-4 h-full" : "card p-4 h-full"} transition hover:shadow-pop`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[13px] font-medium ${dark ? "text-white/70" : "text-muted"}`}>{label}</span>
        {icon && <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${dark ? "bg-white/10 text-white" : tone === "brand" ? "bg-brand-soft text-brand" : "bg-canvas text-ink/70"}`}><Icon name={icon} className="w-4 h-4" /></span>}
      </div>
      <div className="mt-1 text-2xl font-semibold tnum tracking-tight">{value}</div>
      {hint && <div className={`mt-0.5 text-xs ${dark ? "text-white/60" : "text-muted"}`}>{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

export function ProgressBar({ value, max, tone = "bg-green-600", label }: { value: number; max: number; tone?: string; label?: string }) {
  const pct = max ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label} className="h-2 rounded-full bg-canvas border border-line/60 overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-line/70 last:border-0 text-sm">
      <span className="text-muted">{k}</span>
      <span className="font-medium text-right break-words min-w-0">{v ?? "—"}</span>
    </div>
  );
}

export function Avatar({ name, className = "w-8 h-8 text-xs" }: { name: string; className?: string }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return <span className={`inline-flex items-center justify-center rounded-full bg-brand text-white font-semibold ${className}`} aria-hidden>{ini}</span>;
}
