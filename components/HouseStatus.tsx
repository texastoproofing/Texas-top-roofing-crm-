import { Icon } from "@/components/icons";
import { HOUSE_STATUS, type HouseStatus } from "@/lib/street-intel";

// Estado de una casa: color + icono + texto (no depende solo del color)
export function StatusPill({ s, small }: { s: HouseStatus; small?: boolean }) {
  const i = HOUSE_STATUS[s];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${small ? "text-[11px] px-1.5 py-0.5" : "text-xs px-2 py-0.5"}`}
      style={{ background: i.bg, color: i.color }}>
      <Icon name={i.icon} className={small ? "w-3 h-3" : "w-3.5 h-3.5"} strokeWidth={2.25} />{i.label}
    </span>
  );
}
