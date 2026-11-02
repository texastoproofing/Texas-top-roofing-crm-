// Workflow de trabajos, agrupado por etapas como en JobNimbus.
export type StageKey = "lead" | "seguro" | "vendido" | "produccion" | "cobro" | "completado" | "perdido";

export const STAGES: { key: StageKey; label: string; color: string }[] = [
  { key: "lead", label: "Lead", color: "bg-sky-100 text-sky-800 border-sky-200" },
  { key: "seguro", label: "Seguro / Estimado", color: "bg-amber-100 text-amber-800 border-amber-200" },
  { key: "vendido", label: "Vendido", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  { key: "produccion", label: "Producción", color: "bg-violet-100 text-violet-800 border-violet-200" },
  { key: "cobro", label: "Cobro", color: "bg-orange-100 text-orange-800 border-orange-200" },
  { key: "completado", label: "Completado", color: "bg-green-100 text-green-800 border-green-200" },
  { key: "perdido", label: "Perdido", color: "bg-gray-100 text-gray-600 border-gray-200" },
];

export const STATUSES: { key: string; label: string; stage: StageKey }[] = [
  { key: "lead_nuevo", label: "Lead nuevo", stage: "lead" },
  { key: "contactado", label: "Contactado", stage: "lead" },
  { key: "inspeccion_agendada", label: "Inspección agendada", stage: "lead" },
  { key: "inspeccionado", label: "Inspeccionado", stage: "lead" },
  { key: "reclamo_abierto", label: "Reclamo abierto", stage: "seguro" },
  { key: "ajustador", label: "Cita con ajustador", stage: "seguro" },
  { key: "desk_adjuster", label: "Desk adjuster", stage: "seguro" },
  { key: "estimado_enviado", label: "Estimado enviado", stage: "seguro" },
  { key: "aprobado", label: "Aprobado", stage: "vendido" },
  { key: "contrato_firmado", label: "Contrato firmado", stage: "vendido" },
  { key: "suplemento", label: "Suplemento / PA / Appraisal", stage: "vendido" },
  { key: "materiales", label: "Materiales pedidos", stage: "produccion" },
  { key: "instalacion_agendada", label: "Instalación agendada", stage: "produccion" },
  { key: "en_instalacion", label: "En instalación", stage: "produccion" },
  { key: "facturado", label: "Facturado", stage: "cobro" },
  { key: "pago_parcial", label: "Pago parcial", stage: "cobro" },
  { key: "completado", label: "Completado", stage: "completado" },
  { key: "perdido", label: "Perdido", stage: "perdido" },
  { key: "denegado", label: "Reclamo denegado", stage: "perdido" },
];

export function statusInfo(key: string) {
  const s = STATUSES.find((x) => x.key === key) ?? { key, label: key, stage: "lead" as StageKey };
  const st = STAGES.find((x) => x.key === s.stage)!;
  return { ...s, stageLabel: st.label, color: st.color };
}

export const ROLES: { key: string; label: string }[] = [
  { key: "administrador", label: "Administrador" },
  { key: "vendedor", label: "Vendedor" },
  { key: "project_manager", label: "Project manager" },
  { key: "asistente", label: "Asistente" },
];
export const roleLabel = (k: string) => ROLES.find((r) => r.key === k)?.label ?? k;

export const SOURCES: { key: string; label: string }[] = [
  { key: "door_to_door", label: "Door-to-door" },
  { key: "lead_comprado", label: "Lead comprado" },
  { key: "referido", label: "Referido" },
  { key: "web", label: "Web / redes" },
  { key: "trello", label: "Importado de Trello" },
  { key: "otro", label: "Otro" },
];
export const sourceLabel = (k: string) => SOURCES.find((r) => r.key === k)?.label ?? k;

export const APPT_KINDS: { key: string; label: string }[] = [
  { key: "inspeccion", label: "Inspección" },
  { key: "ajustador", label: "Ajustador" },
  { key: "firma", label: "Firma de contrato" },
  { key: "instalacion", label: "Instalación" },
  { key: "seguimiento", label: "Seguimiento" },
  { key: "otra", label: "Otra" },
];
export const apptLabel = (k: string) => APPT_KINDS.find((r) => r.key === k)?.label ?? k;

export const INSURERS = [
  "Allstate", "Farmers", "State Farm", "Progressive", "Great American", "Sagesure",
  "Homesite", "MSI", "Nationwide", "USAA", "Travelers", "Liberty Mutual", "Chubb", "Otra",
];

// Lista de Trello → estado del CRM
export const TRELLO_LIST_MAP: Record<string, string> = {
  "COSTUMER": "lead_nuevo",
  "CUSTOMER": "lead_nuevo",
  "INSPECTION SCHEDULED": "inspeccion_agendada",
  "CLAIM OPEN": "reclamo_abierto",
  "DESK ADJUSTER": "desk_adjuster",
  "APPROVED": "aprobado",
  "PA+APPRAISAL": "suplemento",
  "PA + APPRAISAL": "suplemento",
};

export const TZ = "America/Chicago";
