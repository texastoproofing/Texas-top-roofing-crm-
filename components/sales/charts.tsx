// Gráficas SVG ligeras (sin librerías), legibles en móvil. Valores nulos = sin dato (no se dibujan como cero).
import type { ReactNode } from "react";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const monthLabel = (ym: string) => MES[Number(ym.slice(5, 7)) - 1] ?? ym;
export const SERIES = ["#D71920", "#111318", "#2563eb", "#16a34a", "#d97706"];
const short = (n: number, money: boolean) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n * 10) / 10}`;
  return money ? `$${s}` : s;
};

export function LineChart({ labels, series, money, height = 200, title }: {
  labels: string[]; series: { name: string; values: (number | null)[]; color?: string; dashed?: boolean }[]; money?: boolean; height?: number; title: string;
}) {
  const W = 640, H = height, L = 48, R = 12, T = 14, B = 26;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!all.length) return <EmptyChart>Sin datos para graficar en estos meses.</EmptyChart>;
  const max = Math.max(...all, 0) || 1, min = Math.min(0, ...all);
  const x = (i: number) => L + (labels.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (labels.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const ticks = [0, 0.5, 1].map((f) => min + (max - min) * f);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={title}>
        {ticks.map((t, i) => (
          <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eceef2" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{short(t, !!money)}</text></g>
        ))}
        {labels.map((l, i) => <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#6b7280">{l}</text>)}
        {series.map((s, si) => {
          const color = s.color ?? SERIES[si % SERIES.length];
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const));
          const segs: string[] = []; let cur = "";
          pts.forEach((p) => { if (!p) { if (cur) segs.push(cur); cur = ""; } else cur += `${cur ? "L" : "M"}${p[0]},${p[1]}`; });
          if (cur) segs.push(cur);
          return (
            <g key={s.name}>
              {si === 0 && !s.dashed && segs.map((d, k) => {
                const p0 = pts.find(Boolean)!, pl = [...pts].reverse().find(Boolean)!;
                return k === 0 && segs.length === 1 ? <path key={k} d={`${d}L${pl[0]},${y(min)}L${p0[0]},${y(min)}Z`} fill={color} opacity={0.08} /> : null;
              })}
              {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray={s.dashed ? "5 4" : undefined} />)}
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill="#fff" stroke={color} strokeWidth={2}><title>{`${s.name} · ${labels[i]}: ${money ? "$" : ""}${s.values[i]!.toLocaleString("en-US")}`}</title></circle>)}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && <Legend items={series.map((s, i) => ({ name: s.name, color: s.color ?? SERIES[i % SERIES.length], dashed: s.dashed }))} />}
    </figure>
  );
}

export function Bars({ rows, money, title, unit = "" }: { rows: { label: string; value: number | null; color?: string; sub?: string }[]; money?: boolean; title: string; unit?: string }) {
  const vals = rows.map((r) => r.value).filter((v): v is number => v != null);
  if (!vals.length) return <EmptyChart>Sin datos para comparar.</EmptyChart>;
  const max = Math.max(...vals, 0) || 1;
  return (
    <ul className="space-y-2" aria-label={title}>
      {rows.map((r, i) => (
        <li key={r.label + i} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}{r.sub && <span className="text-muted text-xs"> · {r.sub}</span>}</span><span className="font-semibold tnum shrink-0">{r.value == null ? "—" : money ? `$${r.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `${r.value.toLocaleString("en-US")}${unit}`}</span></div>
          <div className="h-2 rounded-full bg-canvas overflow-hidden mt-1"><div className="h-full rounded-full" style={{ width: `${r.value == null ? 0 : Math.max(2, (Math.max(0, r.value) / max) * 100)}%`, background: r.color ?? SERIES[i % SERIES.length] }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <figcaption className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted">
      {items.map((it) => <span key={it.name} className="inline-flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: it.color, borderTop: it.dashed ? `2px dashed ${it.color}` : undefined }} />{it.name}</span>)}
    </figcaption>
  );
}
export function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-canvas text-sm text-muted text-center py-8 px-4">{children}</div>;
}
