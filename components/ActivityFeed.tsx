import { fmtDateTime } from "@/lib/format";
import { statusInfo } from "@/lib/constants";

type Item = { id: string; kind: string; body: string; created_at: string; author?: { full_name: string } | null };

const KIND_LABEL: Record<string, string> = {
  nota: "Nota", llamada: "Llamada", visita: "Visita", cambio_estado: "Cambio de estado", sistema: "Sistema",
};

function renderBody(i: Item) {
  if (i.kind === "cambio_estado") {
    const [a, b] = i.body.split(" → ");
    return `${statusInfo(a).label} → ${statusInfo(b ?? "").label}`;
  }
  return i.body;
}

export function ActivityFeed({ action, items }: { action: (fd: FormData) => Promise<void>; items: Item[] }) {
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-2">
        <textarea name="body" className="input py-2" rows={2} placeholder="Escribe una nota, resultado de llamada o visita…" required />
        <div className="flex gap-2">
          <select name="kind" className="input w-auto" defaultValue="nota">
            <option value="nota">Nota</option>
            <option value="llamada">Llamada</option>
            <option value="visita">Visita</option>
          </select>
          <button className="btn-primary flex-1 sm:flex-none">Guardar</button>
        </div>
      </form>
      {items.length === 0 ? <p className="muted">Sin notas todavía.</p> : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className={`rounded-lg p-3 text-sm ${i.kind === "cambio_estado" ? "bg-gray-50 text-gray-600" : "bg-white border border-gray-200"}`}>
              <div className="flex justify-between gap-2 text-xs text-gray-500 mb-1">
                <span className="font-semibold">{KIND_LABEL[i.kind] ?? i.kind}{i.author?.full_name ? ` · ${i.author.full_name}` : ""}</span>
                <span>{fmtDateTime(i.created_at)}</span>
              </div>
              <div className="whitespace-pre-wrap break-words">{renderBody(i)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
