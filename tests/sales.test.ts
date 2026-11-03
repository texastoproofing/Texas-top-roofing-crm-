// Pruebas de Sales Performance con casos conocidos. Ejecutar: node --experimental-strip-types --test tests/sales.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  awards, cents, commissionFor, computeMetrics, delta, funnel, ledger, monthlySeries, periodOf, planAt, previousPeriod,
  rank, reachedAt, sumC, type Plan, type SalesJob,
} from "../lib/sales.ts";

const J = (id: string, rep: string, hist: [string, string][], extra: Partial<SalesJob> = {}): SalesJob => ({
  id, number: Number(id.replace(/\D/g, "") || 1), name: `Trabajo ${id}`, status: hist[hist.length - 1][0], repId: rep,
  createdAt: hist[0][1], source: "door_to_door", territoryId: null, estimate: null, approved: null, contract: null, costs: null,
  history: hist.map(([to, at]) => ({ to, at })), ...extra,
});
// Fechas a mediodía UTC = mañana en Texas (mismo día)
const t = (d: string) => `${d}T17:00:00Z`;
const P = { from: "2026-10-01", to: "2026-10-31" };

test("períodos: mes, semana, personalizado y período anterior", () => {
  assert.deepEqual(periodOf("mes", "2026-11-03"), { from: "2026-11-01", to: "2026-11-03" });
  assert.deepEqual(periodOf("semana", "2026-11-04"), { from: "2026-11-02", to: "2026-11-04" }); // miércoles → lunes
  assert.deepEqual(periodOf("custom", "2026-11-03", "2026-10-10", "2026-10-01"), { from: "2026-10-01", to: "2026-10-10" });
  assert.deepEqual(previousPeriod({ from: "2026-10-01", to: "2026-10-31" }), { from: "2026-08-31", to: "2026-09-30" });
});

test("hora de Texas: 11 pm del 31 de oct en Texas cuenta en octubre", () => {
  const j = J("a", "u1", [["lead_nuevo", "2026-11-01T04:30:00Z"]]); // 23:30 CDT del 31-oct
  assert.equal(computeMetrics({ jobs: [j], appts: [], payments: [], plans: [], period: P, minSample: 1, userId: "u1" }).leads, 1);
});

test("contrato firmado cuenta una sola vez aunque el estado cambie varias veces", () => {
  const j = J("1", "u1", [["lead_nuevo", t("2026-10-01")], ["contrato_firmado", t("2026-10-05")], ["suplemento", t("2026-10-08")], ["contrato_firmado", t("2026-10-09")], ["materiales", t("2026-10-12")]], { contract: 20000 });
  assert.equal(reachedAt(j, "contrato_firmado"), "2026-10-05");
  const m = computeMetrics({ jobs: [j], appts: [], payments: [], plans: [], period: P, minSample: 1, userId: "u1" });
  assert.equal(m.signed, 1); assert.equal(m.signedValue, 20000);
});

test("firmado no es cobrado; aprobado no es techo terminado; cancelado sale del volumen", () => {
  const a = J("1", "u1", [["lead_nuevo", t("2026-10-01")], ["aprobado", t("2026-10-03")]], { approved: 15000 });
  const b = J("2", "u1", [["lead_nuevo", t("2026-10-01")], ["contrato_firmado", t("2026-10-04")], ["perdido", t("2026-10-20")]], { contract: 9000 });
  const c = J("3", "u1", [["lead_nuevo", t("2026-10-01")], ["contrato_firmado", t("2026-10-06")]], { contract: 12000.1 });
  const m = computeMetrics({ jobs: [a, b, c], appts: [], payments: [], plans: [], period: P, minSample: 1, userId: "u1" });
  assert.equal(m.collected, null);
  assert.equal(m.completed, 0);
  assert.equal(m.approvedClaims, 3); // seguro: a, b y c llegaron a aprobado o más (b se canceló después)
  const retail = computeMetrics({ jobs: [{ ...c, jobType: "retail" }], appts: [], payments: [], plans: [], period: P, minSample: 1, userId: "u1" });
  assert.equal(retail.approvedClaims, 0);
  assert.equal(m.signed, 1); assert.equal(m.cancelled, 1); assert.equal(m.signedValue, 12000.1);
});

test("conversión: sin leads no divide entre cero; muestra mínima", () => {
  const m0 = computeMetrics({ jobs: [], appts: [], payments: [], plans: [], period: P, minSample: 5 });
  assert.equal(m0.conversion, null);
  const jobs = [J("1", "u1", [["lead_nuevo", t("2026-10-02")], ["contrato_firmado", t("2026-10-09")]])];
  const m = computeMetrics({ jobs, appts: [], payments: [], plans: [], period: P, minSample: 5, userId: "u1" });
  assert.equal(m.conversion, 1); assert.equal(m.conversionEligible, false);
  const r = rank([{ id: "u1", name: "Ana", m }], "conversion");
  assert.equal(r[0].pos, null); // 1 de 1 no encabeza el ranking
});

test("venta compartida 60/40: el equipo cuenta 1 contrato, cada uno su parte", () => {
  const j = J("1", "u1", [["lead_nuevo", t("2026-10-01")], ["contrato_firmado", t("2026-10-05")]], { contract: 10000, splits: [{ userId: "u1", pct: 60 }, { userId: "u2", pct: 40 }] });
  const base = { jobs: [j], appts: [], payments: [{ jobId: "1", amount: 5000, receivedOn: "2026-10-20" }], plans: [], period: P, minSample: 1 };
  assert.equal(computeMetrics(base).signed, 1);
  const u1 = computeMetrics({ ...base, userId: "u1" }), u2 = computeMetrics({ ...base, userId: "u2" });
  assert.equal(u1.signedValue, 6000); assert.equal(u2.signedValue, 4000);
  assert.equal(u1.collected, 3000); assert.equal(u2.signed, 0.4);
});

test("comisiones: 35% del profit, % de venta, fija y mixta; vigencia", () => {
  const j = J("1", "u1", [["contrato_firmado", t("2026-10-05")]], { contract: 20000, costs: 12000 });
  const p35: Plan = { userId: "u1", model: "profit_pct", profitPct: 35, salesPct: null, fixed: null, from: "2026-07-01", to: null };
  assert.equal(commissionFor(j, p35).amount, 2800);
  assert.equal(commissionFor({ ...j, costs: null }, p35).amount, null); // sin costos no se inventa
  assert.equal(commissionFor(j, { ...p35, model: "sales_pct", salesPct: 10 }).amount, 2000);
  assert.equal(commissionFor(j, { ...p35, model: "fixed", fixed: 500 }).amount, 500);
  assert.equal(commissionFor(j, { ...p35, model: "mixed", profitPct: 10, fixed: 250 }).amount, 1050);
  assert.equal(commissionFor(j, null).amount, null);
  const old: Plan = { ...p35, profitPct: 30, from: "2025-01-01", to: "2026-06-30" };
  assert.equal(planAt([old, p35], "u1", "2026-03-01")?.profitPct, 30);
  assert.equal(planAt([old, p35], "u1", "2026-10-05")?.profitPct, 35);
});

test("libro de comisiones: pendiente = aprobada + ajustes − reversos − pagos", () => {
  const l = ledger([
    { userId: "u1", jobId: "1", kind: "aprobada", amount: 2800, at: "" },
    { userId: "u1", jobId: "1", kind: "pago", amount: 1000, at: "" },
    { userId: "u1", jobId: "1", kind: "ajuste", amount: 100.1, at: "" },
    { userId: "u1", jobId: "1", kind: "reverso", amount: -200.2, at: "" },
    { userId: "u2", jobId: "2", kind: "aprobada", amount: 999, at: "" },
  ], "u1");
  assert.equal(l.pending, 1699.9);
});

test("dinero sin errores de coma flotante", () => {
  assert.equal(sumC([0.1, 0.2]), 0.3);
  assert.equal(cents(1.005), 1.01);
});

test("ranking: empate por contratos y luego por quien firmó primero", () => {
  const mk = (signed: number, value: number, first: string) => computeMetrics({ jobs: [], appts: [], payments: [], plans: [], period: P, minSample: 1 }) && ({ ...computeMetrics({ jobs: [], appts: [], payments: [], plans: [], period: P, minSample: 1 }), signed, signedValue: value, firstSigned: first });
  const r = rank([
    { id: "a", name: "Ana", m: mk(2, 10000, "2026-10-10") },
    { id: "b", name: "Beto", m: mk(3, 10000, "2026-10-12") },
    { id: "c", name: "Ceci", m: mk(3, 10000, "2026-10-02") },
    { id: "d", name: "Dani", m: mk(0, 0, "") },
  ], "volumen");
  assert.deepEqual(r.map((x) => [x.id, x.pos]), [["c", 1], ["b", 2], ["a", 3], ["d", null]]);
});

test("variación: sin base no inventa porcentaje", () => {
  assert.equal(delta(10, 0), null);
  assert.deepEqual(delta(15, 10), { value: 50, unit: "%" });
  assert.deepEqual(delta(0.4, 0.3, "pp"), { value: 10, unit: "pp" });
  assert.equal(delta(null, 5), null);
});

test("embudo: conteos, conversión entre etapas, días promedio, estancados y rechazos", () => {
  const jobs = [
    J("1", "u1", [["lead_nuevo", t("2026-10-01")], ["inspeccion_agendada", t("2026-10-03")], ["inspeccionado", t("2026-10-05")], ["reclamo_abierto", t("2026-10-06")], ["aprobado", t("2026-10-16")], ["contrato_firmado", t("2026-10-17")]]),
    J("2", "u1", [["lead_nuevo", t("2026-10-01")], ["inspeccion_agendada", t("2026-10-05")], ["inspeccionado", t("2026-10-07")], ["reclamo_abierto", t("2026-10-08")], ["denegado", t("2026-10-20")]]),
    J("3", "u1", [["lead_nuevo", t("2026-10-02")]]),
  ];
  const f = funnel({ jobs, appts: [], payments: [], period: P, stalledDays: 14, today: "2026-10-31" });
  assert.deepEqual(f.stages.map((s) => s.n), [3, 2, 2, 2, 1, 1, 0, 0]);
  assert.equal(f.stages[1].avgDays, 3); // (2 + 4) / 2
  assert.equal(f.stages[4].fromPrev, 0.5);
  assert.equal(f.rejectionRate, 0.5);
  assert.deepEqual(f.stalled.map((s) => s.number), [3, 1]); // el denegado no está "estancado"
});

test("tendencia mensual y reconocimientos con datos reales", () => {
  const jobs = [J("1", "u1", [["lead_nuevo", t("2026-09-01")], ["contrato_firmado", t("2026-09-10")]], { contract: 8000 })];
  const s = monthlySeries(jobs, ["2026-08", "2026-09"]);
  assert.deepEqual(s.map((x) => x.value), [null, 8000]);
  const m = computeMetrics({ jobs, appts: [], payments: [], plans: [], period: { from: "2026-09-01", to: "2026-09-30" }, minSample: 1, userId: "u1" });
  const prev = computeMetrics({ jobs, appts: [], payments: [], plans: [], period: { from: "2026-08-01", to: "2026-08-31" }, minSample: 1, userId: "u1" });
  const a = awards([{ id: "u1", name: "Ana", m, prev }]);
  assert.equal(a[0].who, "Ana"); assert.equal(a[1].who, "Ana");
  const empty = awards([]);
  assert.equal(empty[0].who, null);
});
