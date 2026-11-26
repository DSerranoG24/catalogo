import assert from "node:assert/strict";
import { bogotaTime, compare, formatAxis, formatCopCompact, longDay, movementTime, parseDashboardSummary, plural, weekday } from "../lib/dashboard-ui.mjs";

const sp = s => s.replace(/\s/g, " ");
const series = (n, last = "2026-11-25") => Array.from({ length: n }, (_, i) => { const d = new Date(`${last}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (n - 1) + i); return { date: d.toISOString().slice(0, 10), total: "0" }; });
const valid = (extra = {}) => ({
  success: true, generatedAt: "2026-11-25T19:32:00.000Z",
  today: { date: "2026-11-25", salesTotal: "845000", salesCount: 3, yesterdaySalesTotal: "754000" },
  month: { salesTotal: "3200000", costOfSales: "1000", salesWithoutCostCount: 2, expensesTotal: null, estimatedProfit: "3199000", previousMonth: { salesTotal: "0", expensesTotal: null, estimatedProfit: "0" } },
  attention: { lowStockCount: 5, outOfStockCount: 0, pendingOrdersCount: 4 },
  salesSeries: series(7),
  recent: [{ kind: "SALE", id: "s1", status: "DELIVERED", total: "128000", at: "2026-11-25T19:00:00.000Z", customerName: null }],
  setup: { hasInventoryItems: true, hasPublishedCatalog: true, hasSales: true }, modules: { expenses: false }, ...extra,
});

// Compact card values: full under one million, then millions with one decimal; exact beyond 2^53.
assert.equal(sp(formatCopCompact("845000")), "$ 845.000");
assert.equal(sp(formatCopCompact("0")), "$ 0");
assert.equal(sp(formatCopCompact("999999")), "$ 999.999");
assert.equal(sp(formatCopCompact("1000000")), "$ 1 M");
assert.equal(sp(formatCopCompact("3200000")), "$ 3,2 M");
assert.equal(sp(formatCopCompact("3249999")), "$ 3,2 M");
assert.equal(sp(formatCopCompact("3250000")), "$ 3,3 M", "half away from zero");
assert.equal(sp(formatCopCompact("-3250000")), "-$ 3,3 M");
assert.equal(sp(formatCopCompact("-5000")), "-$ 5.000");
assert.equal(sp(formatCopCompact("999950000")), "$ 1.000 M");
assert.equal(sp(formatCopCompact("9007199254740993000")), "$ 9.007.199.254.741 M", "beyond Number precision");
assert.equal(sp(formatCopCompact(9223372036854775807n)), "$ 9.223.372.036.854,8 M", "BIGINT max");
// Axis labels.
assert.equal(formatAxis("0"), "0"); assert.equal(formatAxis("999"), "999"); assert.equal(formatAxis("-999"), "-999");
assert.equal(formatAxis("620000"), "620K"); assert.equal(formatAxis("1499"), "1K"); assert.equal(formatAxis("1500"), "2K");
assert.equal(formatAxis("999499"), "999K"); assert.equal(formatAxis("999500"), "1M", "never «1000K»");
assert.equal(formatAxis("845000"), "845K"); assert.equal(formatAxis("3200000"), "3,2M"); assert.equal(formatAxis("-45000"), "-45K");
assert.equal(formatAxis("9007199254740993000"), "9.007.199.254.741M");
// Comparisons.
assert.deepEqual(compare("845000", "754000"), { direction: "up", text: "+12%" });
assert.deepEqual(compare("754000", "845000"), { direction: "down", text: "-11%" });
assert.deepEqual(compare("100", "100"), { direction: "equal", text: "0%" });
assert.equal(compare("100", "0"), null, "previous period in zero: no percentage");
assert.deepEqual(compare("-50", "-100"), { direction: "up", text: "+50%" }, "against a negative base the sign follows the change");
assert.deepEqual(compare("9007199254740993000", "1"), { direction: "up", text: "+900.719.925.474.099.299.900%" });
// Dates and words.
assert.equal(bogotaTime("2026-11-25T19:32:00.000Z"), "14:32");
assert.equal(bogotaTime("2026-11-26T04:59:00.000Z"), "23:59");
assert.equal(movementTime("2026-11-25T19:00:00.000Z", "2026-11-25"), "Hoy, 14:00");
assert.match(movementTime("2026-11-25T04:00:00.000Z", "2026-11-25"), /^24 de nov, 23:00$/, "04:00 UTC is still yesterday in Bogotá");
assert.equal(weekday("2026-11-23"), "Lun"); assert.equal(weekday("2026-11-29"), "Dom");
assert.equal(longDay("2026-11-25"), "Miércoles, 25 de noviembre");
assert.equal(plural(1, "venta", "ventas"), "1 venta"); assert.equal(plural(2, "venta", "ventas"), "2 ventas");

// Validator: valid responses pass; missing fields, wrong types and broken series fail.
assert.equal(parseDashboardSummary(valid(), 7).today.salesTotal, "845000");
const withExpenses = valid({ modules: { expenses: true }, month: { ...valid().month, expensesTotal: "980000", previousMonth: { salesTotal: "0", expensesTotal: "0", estimatedProfit: "0" } } });
assert.equal(parseDashboardSummary(withExpenses, 7).month.expensesTotal, "980000");
const withScheduled = valid({ modules: { expenses: false, scheduledExpenses: true }, attention: { ...valid().attention, scheduledDueSoonCount: 2, scheduledOverdueCount: 1 } });
assert.equal(parseDashboardSummary(withScheduled, 7).attention.scheduledOverdueCount, 1, "F1b attention counts");
const broken = [
  valid({ success: false }), { ...valid(), today: undefined }, valid({ today: { ...valid().today, salesTotal: 845000 } }), valid({ today: { ...valid().today, salesTotal: "1.5" } }),
  valid({ month: { ...valid().month, expensesTotal: "10" } }), valid({ modules: { expenses: true } }), valid({ attention: { ...valid().attention, lowStockCount: -1 } }),
  valid({ salesSeries: series(6) }), valid({ salesSeries: series(7, "2026-11-24") }), valid({ salesSeries: [...series(7).slice(0, 6).reverse(), series(7)[6]] }),
  valid({ recent: Array(6).fill(valid().recent[0]) }), valid({ recent: [{ ...valid().recent[0], status: "DRAFT" }] }), valid({ setup: { hasInventoryItems: "yes", hasPublishedCatalog: true, hasSales: true } }),
  valid({ generatedAt: "ayer" }), null, [],
  valid({ modules: { expenses: false, scheduledExpenses: true } }), valid({ modules: { expenses: false, scheduledExpenses: "yes" } }),
  valid({ attention: { ...valid().attention, scheduledDueSoonCount: 2, scheduledOverdueCount: 0 } }),
  valid({ modules: { expenses: false, scheduledExpenses: true }, attention: { ...valid().attention, scheduledDueSoonCount: -1, scheduledOverdueCount: 0 } }),
];
for (const value of broken) assert.throws(() => parseDashboardSummary(value, 7), /no es válida/, JSON.stringify(value)?.slice(0, 80));
assert.throws(() => parseDashboardSummary(valid(), 30), /no es válida/, "series length must match the requested range");

console.log("PASS dashboard UI: BigInt formatting and abbreviations, comparisons, Bogotá times, strict summary validation");
