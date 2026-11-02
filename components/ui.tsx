import Link from "next/link";
import { statusInfo } from "@/lib/constants";

export function StatusBadge({ status }: { status: string }) {
  const s = statusInfo(status);
  return <span className={`chip ${s.color}`}>{s.label}</span>;
}

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="h1">{title}</h1>
        {sub && <p className="muted mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, name, type = "text", defaultValue, required, placeholder, step, inputMode }: {
  label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean;
  placeholder?: string; step?: string; inputMode?: "numeric" | "decimal" | "tel" | "email" | "text";
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} type={type} defaultValue={defaultValue ?? ""} required={required}
        placeholder={placeholder} step={step} inputMode={inputMode} />
    </div>
  );
}

export function Select({ label, name, options, defaultValue, required, empty }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string | null;
  required?: boolean; empty?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
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

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-6 text-center muted">{children}</div>;
}

export function Stat({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const inner = (
    <div className="card p-4">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-gray-100 last:border-0 text-sm">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-right break-words min-w-0">{v ?? "—"}</span>
    </div>
  );
}
