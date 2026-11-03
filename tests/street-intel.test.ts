// Pruebas de Street Intelligence. Ejecutar: node --experimental-strip-types --test tests/street-intel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addrKey, canvassOrder, houseCounts, nextHouse, streetPriority, streetStormHistory, type HouseLite } from "../lib/street-intel.ts";

const H = (id: string, n: number | null, status: HouseLite["status"] = "not_visited"): HouseLite => ({ id, house_number: n, situs: `${n ?? ""} OAK LN`, status });

test("orden de recorrido: un lado subiendo y el otro bajando, sin 'No contactar'", () => {
  const order = canvassOrder([H("a", 104), H("b", 101), H("c", 103), H("d", 102), H("x", 105, "do_not_contact"), H("v", 107, "visited")]);
  assert.deepEqual(order.map((h) => h.house_number), [101, 103, 104, 102]);
});

test("orden de recorrido: 'No abrió' va en segunda pasada; sin número al final", () => {
  const order = canvassOrder([H("a", 1, "no_answer"), H("b", 3), H("c", null)]);
  assert.deepEqual(order.map((h) => h.id), ["b", "c", "a"]);
});

test("continuar donde lo dejé y saltar casas", () => {
  const order = canvassOrder([H("a", 1), H("b", 3), H("c", 5)]);
  assert.equal(nextHouse(order, null)?.id, "a");
  assert.equal(nextHouse(order, "a")?.id, "b");
  assert.equal(nextHouse(order, "a", new Set(["b"]))?.id, "c");
  assert.equal(nextHouse(order, "c")?.id, "a"); // vuelve al inicio si quedan pendientes
  assert.equal(nextHouse([], null), null);
});

test("conteos y porcentaje de avance", () => {
  const c = houseCounts([H("a", 1, "visited"), H("b", 2), H("c", 3, "do_not_contact"), H("d", 4)]);
  assert.equal(c.total, 4); assert.equal(c.worked, 2); assert.equal(c.pending, 2); assert.equal(c.pct, 50);
  assert.equal(houseCounts([]).pct, 0);
});

const street: [number, number][][] = [[[29.55, -98.30], [29.55, -98.29]]];
test("historial: separa observado de estimado y respeta el radio", () => {
  const cards = streetStormHistory(street, [
    { id: "1", source_key: "spc", event_type: "granizo", event_date: "2026-09-12", lat: 29.56, lng: -98.30, hail_in: 1.75, wind_mph: null, location_text: "Converse", data_quality: "reportado", comments: null },
    { id: "2", source_key: "spc", event_type: "viento", event_date: "2026-05-01", lat: 29.551, lng: -98.295, hail_in: null, wind_mph: 65, location_text: null, data_quality: "medido", comments: null },
    { id: "3", source_key: "spc", event_type: "granizo", event_date: "2026-09-12", lat: 30.5, lng: -97.7, hail_in: 3, wind_mph: null, location_text: "Lejos", data_quality: "reportado", comments: null },
  ], [
    { id: "s1", source_key: "hailpoint", event_date: "2026-09-12", min_hail_in: 2, geom: [[29.5, -98.4], [29.6, -98.4], [29.6, -98.2], [29.5, -98.2], [29.5, -98.4]], bbox: [29.5, -98.4, 29.6, -98.2] },
    { id: "s2", source_key: "hailpoint", event_date: "2026-09-12", min_hail_in: 1, geom: [[29.5, -98.4], [29.6, -98.4], [29.6, -98.2], [29.5, -98.2], [29.5, -98.4]], bbox: [29.5, -98.4, 29.6, -98.2] },
    { id: "s3", source_key: "nexrad", event_date: "2025-01-01", min_hail_in: 2, geom: [[30, -97], [30.1, -97], [30.1, -96.9], [30, -97]], bbox: [30, -97, 30.1, -96.9] },
  ]);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].kind, "observado"); // mismo día: observado primero
  const est = cards.find((c) => c.kind === "estimado")!;
  assert.equal(est.sizeIn, 2); // toma el área más grande del día
  const wind = cards.find((c) => c.type === "viento")!;
  assert.equal(wind.windMph, 65); assert.equal(wind.confidence, "alta");
  assert.equal(streetStormHistory([], [], []).length, 0);
});

test("prioridad: sin granizo no inventa prioridad", () => {
  const p = streetPriority({ cards: [], counts: houseCounts([H("a", 1)]), today: "2026-11-03" });
  assert.equal(p.level, "sin_datos");
  const p2 = streetPriority({ cards: [{ key: "x", date: "2026-09-12", type: "granizo", kind: "estimado", sizeIn: 2.5, windMph: null, source: "", confidence: "media", distanceMi: 0, place: null, note: null, focus: null }], counts: houseCounts([H("a", 1), H("b", 2)]), today: "2026-11-03" });
  assert.equal(p2.level, "alta");
  assert.ok(p2.score <= p2.max);
});

test("direcciones equivalentes para no duplicar leads", () => {
  assert.equal(addrKey("123 Oak Lane, Converse TX"), addrKey("123  OAK LN"));
  assert.notEqual(addrKey("123 Oak Ln"), addrKey("125 Oak Ln"));
});
