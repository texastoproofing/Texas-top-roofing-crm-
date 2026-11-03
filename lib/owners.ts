// Utilidades sin dependencias (se prueban con node --test)
const SUFFIX = new Set(["DRIVE", "DR", "COURT", "CT", "WAY", "LANE", "LN", "BOULEVARD", "BLVD", "STREET", "ST", "ROAD", "RD", "LOOP", "LP",
  "CIRCLE", "CIR", "TRAIL", "TRL", "PARKWAY", "PKWY", "AVENUE", "AVE", "COVE", "CV", "PLACE", "PL", "TERRACE", "TER"]);
// Abreviaturas postales (USPS) que usan los condados
const ABBR: Record<string, string> = {
  DRIVE: "DR", COURT: "CT", LANE: "LN", BOULEVARD: "BLVD", STREET: "ST", ROAD: "RD", LOOP: "LOOP", LP: "LOOP", CIRCLE: "CIR",
  TRAIL: "TRL", PARKWAY: "PKWY", AVENUE: "AVE", COVE: "CV", PLACE: "PL", TERRACE: "TER", BEND: "BND", BOUND: "BND", CROSSING: "XING",
  HOLLOW: "HOLW", RIDGE: "RDG", CANYON: "CYN", CREEK: "CRK", HILL: "HL", HILLS: "HLS", HEIGHTS: "HTS", VALLEY: "VLY", VIEW: "VW",
  POINT: "PT", SPRINGS: "SPGS", SPRING: "SPG", MEADOW: "MDW", MEADOWS: "MDWS", PASS: "PASS", PATH: "PATH", RUN: "RUN", GROVE: "GRV",
  GARDEN: "GDN", GARDENS: "GDNS", PARK: "PARK", LANDING: "LNDG", HARBOR: "HBR", SUMMIT: "SMT", CORNER: "COR", MOUNTAIN: "MTN",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", SQUARE: "SQ", ROW: "ROW", ALLEY: "ALY", MANOR: "MNR", ESTATES: "ESTS", FLATS: "FLTS",
  KEY: "KY", MILL: "ML", FERRY: "FRY", CLOSE: "CLS", VISTA: "VIS", BLUFF: "BLF", GATE: "GT", CREST: "CRST", CHASE: "CHASE",
};
const words = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

// "Jamie Lyn Boulevard" -> "JAMIE LYN" ; "Ivy Horn" -> "IVY HORN" ; "Gage Park" -> "GAGE PARK"
export function streetBase(name: string) {
  const w = words(name);
  if (w.length > 1 && SUFFIX.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}
// Forma normalizada con abreviaturas: "Champions Corner Drive" -> "CHAMPIONS COR DR"
export const streetNorm = (name: string) => words(name).map((x) => ABBR[x] ?? x).join(" ");

// Bexar: "10323 IVY HORN \r\nSCHERTZ, TX 78154"
// Williamson: "2613 CHAMPIONS CORNER DR, LEANDER, TX  78641"
// Travis: "  13402 ANDERSON MILL RD   TX 78613"
export function parseSitus(situs: string) {
  const tc = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bTx\b/, "TX");
  let s = situs.replace(/\r?\n/g, ", ").replace(/\s+/g, " ").trim();
  let street = "", rest = "";
  const m = s.match(/^(\d+)\s+(.*)$/);
  const number = m ? Number(m[1]) : null;
  const after = m ? m[2] : s;
  const travis = after.match(/^(.*?)\s+TX\s+(\d{5})$/);
  if (travis && !after.includes(",")) { street = travis[1].trim(); rest = `TX ${travis[2]}`; }
  else { const i = after.indexOf(","); street = (i >= 0 ? after.slice(0, i) : after).trim(); rest = i >= 0 ? after.slice(i + 1).trim() : ""; }
  const line = [number != null ? `${number} ${tc(street)}` : tc(street), rest ? tc(rest).replace(/\s+/g, " ") : ""].filter(Boolean).join(", ");
  return { number, street: street.toUpperCase(), line };
}

// ¿La calle del condado es la calle de la zona?
export const streetMatches = (situsStreet: string, name: string) => {
  const s = situsStreet.toUpperCase().replace(/^(N|S|E|W)\s+/, "");
  const base = streetBase(name);
  if (s === base || s.startsWith(base + " ")) return true;
  const ns = streetNorm(s), nn = streetNorm(name);
  return ns === nn || ns === streetNorm(base);
};

// "SMITH JOHN A & MARY B" -> { first: "John", last: "Smith" } ; empresas/fideicomisos -> null
export function ownerToPerson(owner: string | null | undefined) {
  if (!owner) return null;
  if (/\b(LLC|INC|TRUST|TR|LP|LTD|CORP|COMPANY|CO|HOMES|PROPERT|ESTATE|BANK|ASSOC|HOA|SFR|BORROWER|PARTNERS)\b/i.test(owner)) return null;
  const main = owner.split("&")[0].replace(/,/g, " ").trim().split(/\s+/);
  if (main.length < 2) return null;
  const tc = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
  return { last: tc(main[0]), first: tc(main[1]) };
}

// ¿La dirección postal del dueño es la misma casa? (cuando el condado no publica la exención homestead)
export const mailingIsSitus = (mailing: string | null | undefined, number: number | null) =>
  !!mailing && number != null && new RegExp(`(^|\\s)${number}\\s`).test(mailing.toUpperCase() + " ");
