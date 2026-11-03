// Utilidades sin dependencias (se prueban con node --test)
const SUFFIX = new Set(["DRIVE", "DR", "COURT", "CT", "WAY", "LANE", "LN", "BOULEVARD", "BLVD", "STREET", "ST", "ROAD", "RD", "LOOP", "LP",
  "CIRCLE", "CIR", "TRAIL", "TRL", "PARKWAY", "PKWY", "AVENUE", "AVE", "COVE", "CV", "PLACE", "PL", "TERRACE", "TER"]);

// "Jamie Lyn Boulevard" -> "JAMIE LYN" ; "Ivy Horn" -> "IVY HORN" ; "Gage Park" -> "GAGE PARK"
export function streetBase(name: string) {
  const w = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (w.length > 1 && SUFFIX.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}

// "10323 IVY HORN \r\nSCHERTZ, TX 78154" -> { number: 10323, street: "IVY HORN", line: "10323 Ivy Horn, Schertz, TX 78154" }
export function parseSitus(situs: string) {
  const [l1, l2 = ""] = situs.split(/\r?\n/).map((x) => x.replace(/\s+/g, " ").trim());
  const m = l1.match(/^(\d+)\s+(.*)$/);
  const tc = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bTx\b/, "TX");
  return { number: m ? Number(m[1]) : null, street: (m ? m[2] : l1).toUpperCase(), line: [tc(l1), tc(l2)].filter(Boolean).join(", ") };
}

export const streetMatches = (situsStreet: string, base: string) => {
  const s = situsStreet.replace(/^(N|S|E|W)\s+/, "");
  return s === base || s.startsWith(base + " ");
};

// "SMITH JOHN A & MARY B" -> { first: "John", last: "Smith" } ; empresas/fideicomisos -> null
export function ownerToPerson(owner: string | null | undefined) {
  if (!owner) return null;
  if (/\b(LLC|INC|TRUST|TR|LP|LTD|CORP|COMPANY|CO|HOMES|PROPERT|ESTATE|BANK|ASSOC|HOA|SFR|BORROWER|PARTNERS)\b/i.test(owner)) return null;
  const main = owner.split("&")[0].trim().split(/\s+/);
  if (main.length < 2) return null;
  const tc = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
  return { last: tc(main[0]), first: tc(main[1]) };
}
