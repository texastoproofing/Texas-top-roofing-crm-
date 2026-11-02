import { TRELLO_LIST_MAP } from "./constants";

export type ImportRow = {
  cardId: string;
  list: string;
  status: string;
  first_name: string;
  last_name: string;
  insurer: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  claim_number: string | null;
  policy_number: string | null;
  date_of_loss: string | null;
  desc: string;
};

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12,
};

const KNOWN_INSURER = /\b(msi|farmers|state\s?farm|all\s?state|progressive|sagesure|homesite|nationwide|usaa|great american|travelers|liberty|chubb|american family|foremost|safeco|hippo|lemonade|kin|openly|universal|insurance)\b/i;

const pad = (n: number) => String(n).padStart(2, "0");

export function parseDate(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/,/g, " ").replace(/\s+de\s+/g, " ");
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = t.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); // formato de EE. UU.: mes/día/año
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[1])}-${pad(+m[2])}`;
  }
  m = t.match(/(\d{1,2})\s+([a-záéíóú]+)\.?\s+(\d{4})/); // 10 Mayo 2026
  if (m && MONTHS[m[2]]) return `${m[3]}-${pad(MONTHS[m[2]])}-${pad(+m[1])}`;
  m = t.match(/([a-záéíóú]+)\.?\s+(\d{1,2})\s+(\d{4})/); // May 10 2026
  if (m && MONTHS[m[1]]) return `${m[3]}-${pad(MONTHS[m[1]])}-${pad(+m[2])}`;
  return null;
}

// Busca "etiqueta: valor" en la descripción
function labeled(desc: string, labels: RegExp): string | null {
  for (const line of desc.split(/\n/)) {
    const m = line.match(labels);
    if (m) {
      const v = line.slice((m.index ?? 0) + m[0].length).replace(/^[\s:#\-–*]+/, "").replace(/\*+/g, "").trim();
      if (v) return v;
    }
  }
  return null;
}

export function parseCard(card: { id: string; name: string; desc?: string }, listName: string): ImportRow {
  const desc = card.desc ?? "";
  // Nombre de la tarjeta: "Nombre Apellido - Aseguradora" (o "Nombre Apellido Aseguradora")
  const [rawName, ...rest] = card.name.split(/\s+[-–—]\s+/);
  let insurer: string | null = rest.join(" - ").trim() || null;
  let name = rawName.trim();
  if (!insurer) {
    const m = name.match(/\s(MSI|Farmers|State Farm|Allstate|All State|Progressive|Sagesure|Homesite|Nationwide|USAA|Great American)$/i);
    if (m) { insurer = m[1]; name = name.slice(0, m.index).trim(); }
  }
  // Solo se acepta como aseguradora si parece una (ej. "Cristina Robledo - Elias Robledo" no lo es)
  if (insurer && !KNOWN_INSURER.test(insurer)) insurer = null;
  if (insurer && /^all\s?state$/i.test(insurer)) insurer = "Allstate";
  const parts = name.split(/\s+/);
  const first_name = parts.length > 2 ? parts.slice(0, -2).join(" ") : parts[0] ?? "";
  const last_name = parts.length > 2 ? parts.slice(-2).join(" ") : parts.slice(1).join(" ");

  const phone = desc.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0]?.trim() ?? null;
  const email = desc.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;

  // Dirección: línea con número + calle, idealmente con ", TX 78xxx"
  let address: string | null = null, city: string | null = null, zip: string | null = null;
  const addrLine = desc.split(/\n/).map((l) => l.replace(/\*+/g, "").trim())
    .find((l) => /^\D{0,25}\d{2,6}\s+\w+/.test(l) && /\b7[5-9]\d{3}\b/.test(l))
    ?? desc.split(/\n/).map((l) => l.replace(/\*+/g, "").trim()).find((l) => /\b\d{3,6}\s+[A-Za-z].*\b(st|street|dr|drive|ln|lane|rd|road|ct|court|cv|cove|blvd|trl|trail|way|loop|pass|path|pl|place|ave|avenue|cir|circle|bend|run)\b/i.test(l));
  if (addrLine) {
    const clean = addrLine.replace(/^[^\d]*?(?=\d{2,6}\s)/, "");
    zip = clean.match(/\b(7[5-9]\d{3})\b/)?.[1] ?? null;
    const m = clean.match(/^(.*?),\s*([^,]+?),?\s*(TX|Texas)?\s*(7[5-9]\d{3})?\s*$/i);
    if (m && m[2] && !/^\d/.test(m[2])) { address = m[1].trim(); city = m[2].replace(/\b(TX|Texas)\b/i, "").trim() || null; }
    else address = clean.replace(/,?\s*(TX|Texas)?\s*7[5-9]\d{3}\s*$/i, "").trim();
  }

  const claim = labeled(desc, /\b(claim(\s*(number|no\.?|#))?|reclamo|n[uú]mero de reclamo)\b/i);
  const policy = labeled(desc, /\b(policy(\s*(number|no\.?|#))?|p[oó]liza)\b/i);
  const dolRaw = labeled(desc, /\b(DOL|date of loss|fecha de (la )?p[eé]rdida|fecha de (la )?tormenta)\b/i);

  return {
    cardId: card.id,
    list: listName,
    status: TRELLO_LIST_MAP[listName.trim().toUpperCase()] ?? "lead_nuevo",
    first_name, last_name, insurer, phone, email, address, city, zip,
    claim_number: claim ? claim.split(/\s/)[0] : null,
    policy_number: policy ? policy.split(/\s/)[0] : null,
    date_of_loss: dolRaw ? parseDate(dolRaw) : null,
    desc,
  };
}

export function parseTrelloExport(json: any): ImportRow[] {
  const lists = new Map<string, string>();
  for (const l of json?.lists ?? []) if (!l.closed) lists.set(l.id, l.name);
  return (json?.cards ?? [])
    .filter((c: any) => !c.closed && lists.has(c.idList))
    .map((c: any) => parseCard(c, lists.get(c.idList)!));
}
