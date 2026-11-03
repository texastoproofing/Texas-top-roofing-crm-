// Pruebas del motor de Storm Intelligence. Ejecutar: node --experimental-strip-types --test tests/storm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpc } from "../lib/spc.ts";
import { pointInRing, zipOfPoint, scoreZips, leadExposure, periodFromPreset, DEFAULT_WEIGHTS } from "../lib/storm.ts";

const BBOX = [29.2, -98.9, 31.4, -96.9];
const square: [number, number][] = [[30.5, -97.9], [30.5, -97.8], [30.6, -97.8], [30.6, -97.9], [30.5, -97.9]];

test("punto dentro y fuera de un polígono", () => {
  assert.equal(pointInRing(30.55, -97.85, square), true);
  assert.equal(pointInRing(30.7, -97.85, square), false);
  assert.equal(zipOfPoint(30.55, -97.85, [{ zip: "78641", name: "Leander", geom: square, bbox: [30.5, -97.9, 30.6, -97.8] }]), "78641");
});

test("SPC: tamaño en centésimas, día 12Z–12Z, solo Texas y dentro del área", () => {
  const csv = [
    "Time,Size,Location,County,State,Lat,Lon,Comments",
    "2310,175,2 NW LEANDER,WILLIAMSON,TX,30.59,-97.88,QUARTER TO GOLF BALL (EWX)",
    "0130,250,CEDAR PARK,WILLIAMSON,TX,30.51,-97.82,TENNIS BALL, ROOF DAMAGE (EWX)",
    "2000,100,NORMAN,CLEVELAND,OK,35.2,-97.4,(OUN)",
    "2000,100,AMARILLO,POTTER,TX,35.2,-101.8,(AMA)",
  ].join("\n");
  const r = parseSpc(csv, "2025-05-28", "granizo", BBOX);
  assert.equal(r.length, 2);
  assert.equal(r[0].hail_in, 1.75);
  assert.equal(r[0].observed_at, "2025-05-28T23:10:00.000Z");
  assert.equal(r[0].event_date, "2025-05-28"); // 6:10 pm en Texas
  assert.equal(r[1].observed_at, "2025-05-29T01:30:00.000Z"); // hora < 12Z = día UTC siguiente
  assert.equal(r[1].event_date, "2025-05-28"); // 8:30 pm del 28 en Texas
  assert.equal(r[1].comments, "TENNIS BALL, ROOF DAMAGE (EWX)");
  const w = parseSpc("Time,Speed,Location,County,State,Lat,Lon,Comments\n2200,UNK,AUSTIN,TRAVIS,TX,30.27,-97.74,TREES DOWN", "2025-05-28", "viento", BBOX);
  assert.equal(w.length, 1);
  assert.equal(w[0].wind_mph, null);
});

test("Score: ZIP con granizo fuerte supera a ZIP sin eventos; explica y no pasa de 100", () => {
  const period = { from: "2025-01-01", to: "2026-11-02" };
  const zips = [
    { zip: "78641", name: "Leander", geom: square, bbox: [30.5, -97.9, 30.6, -97.8] },
    { zip: "78701", name: "Downtown", geom: null, bbox: null },
  ];
  const stats = [{ zip: "78641", event_date: "2025-05-28", source_key: "hailpoint", max_hail_in: 3.25, frac_1: 1, frac_175: 0.9, frac_25: 0.6 }];
  const events = [{ id: "e1", source_key: "spc", event_type: "granizo" as const, event_date: "2025-05-28", observed_at: null, lat: 30.55, lng: -97.85, hail_in: 3, wind_mph: null, location_text: "Leander", county: null, zip: null, data_quality: "reportado", precision_note: null, published_at: null }];
  const eventZip = new Map([["e1", "78641"]]);
  const s = scoreZips({ zips, stats, events, eventZip, jobs: [], assignments: [], weights: DEFAULT_WEIGHTS, period, today: "2026-11-02" });
  const a = s.find((x) => x.zip === "78641")!, b = s.find((x) => x.zip === "78701")!;
  assert.ok(a.combinedScore > b.combinedScore);
  assert.ok(a.exposureScore <= 100 && a.confidenceScore <= 100);
  assert.equal(b.exposureScore, 0);
  assert.ok(a.reasons.some((r) => r.includes("estimación")));
  assert.ok(a.confidenceScore >= 80); // radar + tierra el mismo día + contorno
});

test("Lead: dentro de franja = exposición potencial; daño solo con reclamo aprobado", () => {
  const period = periodFromPreset("todo", "2026-11-02", "2024-01-01");
  const swath = { id: "s1", source_key: "hailpoint", event_date: "2025-05-28", min_hail_in: 2.25, geom: square, bbox: [30.5, -97.9, 30.6, -97.8] };
  const base = { id: "j1", number: 1, customer: "X", address: "", zip: "78641", job_type: "seguro", repId: null, repName: null, lat: 30.55, lng: -97.85 };
  const lead = leadExposure({ ...base, status: "lead_nuevo" }, [swath], [], [], period)!;
  assert.equal(lead.exposure, "exposicion_potencial");
  assert.equal(lead.followUp, "inspeccion_recomendada");
  const approved = leadExposure({ ...base, status: "aprobado" }, [swath], [], [], period)!;
  assert.equal(approved.followUp, "dano_documentado");
  const far = leadExposure({ ...base, status: "lead_nuevo", lat: 29.5, lng: -98.5 }, [swath], [], [], period)!;
  assert.equal(far.exposure, "sin_evidencia");
  assert.equal(far.followUp, null);
  assert.equal(leadExposure({ ...base, status: "lead_nuevo", lat: null, lng: null }, [swath], [], [], period), null);
});

test("zonas afectadas: ordena por granizo y respeta el período", async () => {
  const { hailZones } = await import("../lib/storm.ts");
  const z = (zip: string): any => ({ zip, name: zip, geom: square, bbox: [30.5, -97.9, 30.6, -97.8] });
  const stats: any[] = [
    { zip: "A", event_date: "2025-05-28", source_key: "hailpoint", max_hail_in: 2.75, frac_1: 0.9, frac_175: 0.6, frac_25: 0.1 },
    { zip: "B", event_date: "2025-05-28", source_key: "hailpoint", max_hail_in: 1.25, frac_1: 0.2, frac_175: 0, frac_25: 0 },
    { zip: "C", event_date: "2023-05-28", source_key: "hailpoint", max_hail_in: 3, frac_1: 1, frac_175: 1, frac_25: 1 },
  ];
  const r = hailZones({ zips: [z("A"), z("B"), z("C")], stats, events: [], period: { from: "2024-01-01", to: "2026-11-02" } });
  assert.deepEqual(r.map((x) => x.zip), ["A", "B"]); // C fuera del período
  assert.ok(r[0].score > r[1].score);
  assert.match(r[0].reasons[0], /60% del ZIP/);
});

test("NEXRAD: lee el CSV de NOAA SWDI y se detiene en el resumen", async () => {
  const { parseSwdi } = await import("../lib/region-parse.ts");
  const csv = "ZTIME,WSR_ID,CELL_ID,PROB,SEVPROB,MAXSIZE,LAT,LON\n2025-05-28T22:18:47Z,KEWX,U5,100,90,2,30.769,-98.137\n2025-05-28T22:20:00Z,KEWX,U5,100,90,x,30.7,-98.1\nsummary\ncount,2\n";
  const r = parseSwdi(csv);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { t: "2025-05-28T22:18:47Z", radar: "KEWX", cell: "U5", size: 2, lat: 30.769, lng: -98.137 });
});

test("dueños: nombre de calle, dirección del condado y nombre de persona", async () => {
  const { streetBase, parseSitus, streetMatches, ownerToPerson } = await import("../lib/owners.ts");
  assert.equal(streetBase("Jamie Lyn Boulevard"), "JAMIE LYN");
  assert.equal(streetBase("Gage Park"), "GAGE PARK");
  const p = parseSitus("10323 IVY HORN \r\nSCHERTZ, TX 78154");
  assert.equal(p.number, 10323); assert.equal(p.street, "IVY HORN"); assert.equal(p.line, "10323 Ivy Horn, Schertz, TX 78154");
  assert.ok(streetMatches("IVY HORN", "Ivy Horn")); assert.ok(streetMatches("JAMIE LYN BLVD", "Jamie Lyn Boulevard")); assert.ok(!streetMatches("IVY HORNET", "Ivy Horn"));
  assert.ok(streetMatches("ALAMO BND", "Alamo Bound")); assert.ok(streetMatches("CHAMPIONS CORNER DR", "Champions Corner Drive"));
  const w = parseSitus("2613 CHAMPIONS CORNER DR, LEANDER, TX  78641");
  assert.equal(w.street, "CHAMPIONS CORNER DR"); assert.equal(w.line, "2613 Champions Corner Dr, Leander, TX 78641");
  const t = parseSitus("  3003 BLAZNGSTR TRL   TX 78613");
  assert.equal(t.number, 3003); assert.equal(t.street, "BLAZNGSTR TRL");
  assert.deepEqual(ownerToPerson("SMITH JOHN A & MARY B"), { first: "John", last: "Smith" });
  assert.equal(ownerToPerson("PROGRESS RESIDENTIAL BORROWER 6 LLC"), null);
});
