import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Inicio with figures: real Chromium and Next proxy, simulated GET /api/dashboard/summary (docs/dashboard-summary.md).
const today = "2026-11-25", generatedAt = "2026-11-25T19:32:00.000Z"; // 14:32 in Bogotá
const series = (days, values = {}) => Array.from({ length: days }, (_, i) => {
  const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (days - 1) + i);
  const date = d.toISOString().slice(0, 10); return { date, total: values[date] ?? "0" };
});
const week = { "2026-11-19": "620000", "2026-11-20": "680000", "2026-11-21": "720000", "2026-11-22": "650000", "2026-11-23": "780000", "2026-11-24": "754000", "2026-11-25": "845000" };
function summary(days, patch = {}) {
  const base = {
    success: true, generatedAt,
    today: { date: today, salesTotal: "845000", salesCount: 3, yesterdaySalesTotal: "754000" },
    month: { salesTotal: "9000000", costOfSales: "5800000", salesWithoutCostCount: 2, expensesTotal: null, estimatedProfit: "3200000",
      previousMonth: { salesTotal: "8000000", expensesTotal: null, estimatedProfit: "2962963" } },
    attention: { lowStockCount: 5, outOfStockCount: 2, pendingOrdersCount: 4 },
    salesSeries: series(days, week),
    recent: [
      { kind: "SALE", id: randomUUID(), status: "DELIVERED", total: "128000", at: "2026-11-25T19:00:00.000Z", customerName: "Carlos Prueba" },
      { kind: "SALE", id: randomUUID(), status: "CANCELLED", total: "50000", at: "2026-11-25T15:00:00.000Z", customerName: null },
      { kind: "SALE", id: randomUUID(), status: "RETURNED", total: "9007199254740993000", at: "2026-11-24T04:00:00.000Z", customerName: null },
    ],
    setup: { hasInventoryItems: true, hasPublishedCatalog: true, hasSales: true }, modules: { expenses: false },
  };
  return typeof patch === "function" ? patch(base) : { ...base, ...patch };
}
const zeroAccount = days => summary(days, base => ({ ...base,
  today: { date: today, salesTotal: "0", salesCount: 0, yesterdaySalesTotal: "0" },
  month: { salesTotal: "0", costOfSales: "0", salesWithoutCostCount: 0, expensesTotal: null, estimatedProfit: "0", previousMonth: { salesTotal: "0", expensesTotal: null, estimatedProfit: "0" } },
  attention: { lowStockCount: 0, outOfStockCount: 0, pendingOrdersCount: 0 }, salesSeries: series(days), recent: [],
  setup: { hasInventoryItems: false, hasPublishedCatalog: false, hasSales: false } }));

let scenario = days => summary(days), catalogs = [{ id: randomUUID() }], failNext = 0, delays = {};
const requests = [], unknown = [], checks = [];
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  req.resume(); await new Promise(resolve => req.on("end", resolve));
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/me") return reply({ user: { email: "fixture@example.invalid", name: null, emailVerifiedAt: new Date().toISOString(), hasLocalPassword: true } });
  if (url.pathname === "/api/catalogs") return reply({ catalogs: catalogs.map(c => ({ ...c, publicId: c.id, name: "Catálogo", slug: c.id, active: true, archivedAt: null })) });
  if (url.pathname === "/api/dashboard/summary") {
    const days = Number(url.searchParams.get("days"));
    requests.push(days);
    if (delays[days]) { const wait = delays[days]; delete delays[days]; await new Promise(resolve => setTimeout(resolve, wait)); }
    if (failNext > 0) { failNext--; return reply({ success: false, error: "DASHBOARD_UNAVAILABLE", message: "No se pudo cargar el resumen. Intenta de nuevo." }, 500); }
    return reply(scenario(days));
  }
  unknown.push(`${req.method} ${url.pathname}`); return reply({ message: "No disponible en la prueba." }, 404);
}

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll }) => {
    const text = () => evaluate("document.querySelector('main')?.innerText ?? ''");
    const norm = s => s.replace(/\s+/g, " ");
    const waitText = async value => { try { await poll(async () => norm(await text()).includes(value)); } catch { throw new Error(`Texto no encontrado: ${value}\n${(await text()).slice(0, 1500)}`); } };
    const gone = async value => poll(async () => !norm(await text()).includes(value));
    const viewport = async width => { await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }); await new Promise(r => setTimeout(r, 300)); };
    const open = async () => { await command("Page.navigate", { url: "http://localhost:4338/dashboard" }); await poll(() => evaluate(`Boolean(document.querySelector('#chart-title'))||Boolean(document.querySelector('[role="alert"]'))`)); };
    const key = async (name, code, vk) => { for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk, ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); };
    const pressRange = range => evaluate(`[...document.querySelectorAll('[aria-label="Rango de la gráfica"] button')].find(b=>b.textContent.trim()===${JSON.stringify(`${range} días`)}).click()`);
    const rows = () => evaluate(`document.querySelectorAll('#chart-title ~ * table tbody tr, section[aria-labelledby="chart-title"] table tbody tr').length`);
    const shot = async name => {
      const folder = process.env.DASHBOARD_SCREENSHOTS; if (!folder) return;
      const { data } = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, "base64"));
    };

    // Full account, one catalog.
    await viewport(1440);
    await open();
    await waitText("Ventas hoy");
    const main = norm(await text());
    for (const part of ["$ 845.000", "+12% vs ayer", "Utilidad del mes", "$ 3,2 M", "+8% vs mes anterior", "Utilidad estimada con el costo registrado", "2 ventas sin costo",
      "Requiere tu atención", "5 productos con stock bajo", "2 productos agotados", "4 pedidos nuevos", "Ventas de la semana", "Últimos movimientos", "Carlos Prueba", "Sin cliente",
      "Hoy, 14:00", "$ 9.007.199.254.740.993.000", "Tu negocio está seguro con Vitrinaya", "Conectado", "Última actualización: 14:32"]) assert.ok(main.includes(part), part);
    for (const absent of ["Te deben", "Gastos del mes", "fiados", "Fiados", "equipos", "Recibir equipo", "Registrar abono", "Ver todos", "Primeros pasos"]) assert.ok(!main.includes(absent), `${absent} must not appear`);
    assert.equal(await evaluate(`[...document.querySelectorAll('a')].filter(a=>a.textContent.includes('Nueva venta')&&a.getClientRects().length).length`), 1, "a single «Nueva venta»");
    assert.equal(await evaluate(`document.querySelector('a[href="/dashboard/inventario"][class*="underline"]')?.textContent.includes('2 ventas sin costo')`), true, "sales without cost link to Inventario");
    // «Revisar» points to the list until /catalogs answers, then to the only catalog.
    await poll(() => evaluate(`[...document.querySelectorAll('section[aria-labelledby="attention-title"] a')].at(-1)?.getAttribute('href')===${JSON.stringify(`/dashboard/catalogos/${catalogs[0].id}`)}`));
    const actions = await evaluate(`[...document.querySelectorAll('section[aria-labelledby="attention-title"] a')].map(a=>[a.textContent.trim(),a.getAttribute('href')])`);
    assert.deepEqual(actions, [["Ver", "/dashboard/inventario"], ["Ver", "/dashboard/inventario"], ["Revisar", `/dashboard/catalogos/${catalogs[0].id}`]]);
    assert.equal(await rows(), 7);
    const labels = await evaluate(`[...document.querySelectorAll('section[aria-labelledby="chart-title"] [aria-hidden="true"] span')].map(s=>s.textContent.trim()).filter(Boolean)`);
    for (const label of ["620K", "845K", "Lun", "Dom", "Mié"]) assert.ok(labels.includes(label), label);
    assert.equal(await evaluate(`[...document.querySelectorAll('section[aria-labelledby="recent-title"] li a')].length`), 0, "Ventas has no direct link to one sale: rows are not links");
    await shot("inicio-1440");
    checks.push("Full account: Ventas hoy +12% vs ayer with sparkline, Utilidad $ 3,2 M +8% with note and «2 ventas sin costo» → Inventario, no Gastos/Te deben/fiados/equipos, three attention rows (Revisar → the only catalog), 7 labelled bars, recent with «Sin cliente» and amounts > 2^53, footer 14:32, one «Nueva venta»");

    // Several catalogs: «Revisar» goes to the list.
    catalogs = [{ id: randomUUID() }, { id: randomUUID() }];
    await open(); await waitText("4 pedidos nuevos");
    await poll(() => evaluate(`[...document.querySelectorAll('section[aria-labelledby="attention-title"] a')].at(-1)?.getAttribute('href')==='/dashboard/catalogos'`));
    checks.push("Several catalogs: «Revisar» links to /dashboard/catalogos");

    // Expenses module on (API and menu): the violet card appears and Inicio offers «Registrar gasto».
    scenario = days => summary(days, base => ({ ...base, modules: { expenses: true }, month: { ...base.month, expensesTotal: "980000", previousMonth: { ...base.month.previousMonth, expensesTotal: "980000" } } }));
    await open(); await waitText("Utilidad del mes");
    await waitText("Gastos del mes");
    const withExpenses = norm(await text());
    assert.ok(withExpenses.includes("$ 980.000") && withExpenses.includes("Igual que el mes anterior"));
    assert.equal(await evaluate(`document.querySelectorAll('section[aria-labelledby="figures-title"] article').length`), 3);
    assert.equal(await evaluate(`[...document.querySelectorAll('section[aria-labelledby="quick-actions"] a')].map(a=>a.getAttribute('href')).join()`), "/dashboard/gastos,/dashboard/inventario");
    checks.push("modules.expenses=true with Gastos enabled: violet «Gastos del mes» card ($ 980.000, igual que el mes anterior), three figure cards, «Registrar gasto» quick action");

    // Zero attention rows, negative profit, no previous data.
    scenario = days => summary(days, base => ({ ...base, attention: { lowStockCount: 0, outOfStockCount: 0, pendingOrdersCount: 0 },
      month: { ...base.month, salesWithoutCostCount: 0, estimatedProfit: "-5000", previousMonth: { salesTotal: "0", expensesTotal: null, estimatedProfit: "0" } } }));
    await open(); await waitText("Todo en orden");
    const calm = norm(await text());
    assert.ok(calm.includes("-$ 5.000") && calm.includes("Sin datos del periodo anterior") && !calm.includes("ventas sin costo"));
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-figure="Utilidad del mes"]')).color`), "rgb(180, 35, 24)", "negative in red, never hidden");
    assert.equal(await evaluate(`document.querySelectorAll('section[aria-labelledby="attention-title"] li').length`), 0);
    checks.push("All attention rows in zero → «Todo en orden»; negative profit shown as -$ 5.000 in red; previous period 0 → «Sin datos del periodo anterior»");

    // New account: first steps on top, figures in zero still shown.
    scenario = zeroAccount;
    await open(); await waitText("Primeros pasos");
    const fresh = norm(await text());
    assert.ok(fresh.indexOf("Primeros pasos") < fresh.indexOf("Ventas hoy"), "first steps above the figures");
    assert.equal((fresh.match(/Pendiente/g) ?? []).length, 3);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('section[aria-labelledby="first-steps-title"] a')].map(a=>a.getAttribute('href'))`), ["/dashboard/inventario", "/dashboard/catalogos", "/dashboard/ventas"]);
    assert.ok(fresh.includes("$ 0") && fresh.includes("Todavía no hay ventas confirmadas.") && fresh.includes("Todo en orden"));
    await shot("inicio-cuenta-nueva-1440");
    checks.push("New account: «Primeros pasos» with three pending tasks and links, figures in zero below");

    // Fast range change: the slow 30-day reply must not replace the 90-day chart.
    scenario = days => summary(days);
    await open(); await waitText("Ventas hoy");
    delays[30] = 1500;
    await pressRange(30); await pressRange(90);
    await poll(async () => (await rows()) === 90);
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(await rows(), 90, "late 30-day reply ignored");
    await waitText("Ventas de los últimos 90 días");
    assert.equal(await evaluate(`[...document.querySelectorAll('[aria-label="Rango de la gráfica"] button')].map(b=>b.getAttribute('aria-pressed')).join()`), "false,false,true");
    assert.ok(!norm(await text()).includes("845K"), "no per-bar labels at 90 days");
    // Keyboard on the chart shows one day's value.
    await evaluate(`document.querySelector('section[aria-labelledby="chart-title"] [tabindex="0"]').focus()`);
    await key("ArrowLeft", "ArrowLeft", 37);
    await poll(async () => norm(await evaluate(`document.querySelector('#chart-current').innerText`)).includes("Martes, 24 de noviembre: $ 754.000"));
    await key("End", "End", 35);
    await poll(async () => norm(await evaluate(`document.querySelector('#chart-current').innerText`)).includes("Miércoles, 25 de noviembre: $ 845.000"));
    assert.notEqual(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), "none", "visible focus on the chart");
    checks.push("Range 30 → 90 quickly with a slow 30-day reply: chart keeps 90 days; 90 days hides bar labels; arrows/End show the day's value (aria-live)");

    // Error with data: alert, data kept, retry; invalid contract is an error too.
    failNext = 1;
    await pressRange(7);
    await waitText("No se pudo actualizar el resumen.");
    assert.ok(norm(await text()).includes("Mostramos las últimas cifras cargadas.") && norm(await text()).includes("$ 845.000") && norm(await text()).includes("Sin conexión"));
    await evaluate(`[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Reintentar').click()`);
    await gone("No se pudo actualizar el resumen."); await waitText("Conectado"); await poll(async () => (await rows()) === 7);
    scenario = days => summary(days, base => ({ ...base, today: { ...base.today, salesTotal: 845000 } }));
    await pressRange(30);
    await waitText("No se pudo actualizar el resumen.");
    scenario = days => summary(days);
    // Error without data: message and retry from scratch.
    failNext = 1;
    await open(); await waitText("No se pudo cargar el resumen");
    assert.ok(!norm(await text()).includes("Ventas hoy"));
    await evaluate(`[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Reintentar').click()`);
    await waitText("Ventas hoy");
    checks.push("Errors: with data the alert keeps the last figures and «Reintentar» recovers; a reply outside the contract is an error; without data a clear message and retry");

    // Focus refresh at most once a minute.
    await open(); await waitText("Ventas hoy");
    const before = requests.length;
    await evaluate(`window.dispatchEvent(new Event('focus'))`); await new Promise(r => setTimeout(r, 400));
    assert.equal(requests.length, before, "no refresh within a minute");
    await evaluate(`(()=>{const real=Date.now;Date.now=()=>real()+61000;window.dispatchEvent(new Event('focus'));})()`);
    await poll(() => requests.length === before + 1);
    checks.push("Tab focus refreshes the summary only after a minute");

    // Layout: no overflow and targets ≥ 44 px.
    for (const width of [375, 768, 1024, 1440]) {
      await viewport(width); await open(); await waitText("Ventas hoy");
      const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      assert.ok(overflow <= 0, `overflow ${overflow}px at ${width}`);
      const small = await evaluate(`[...document.querySelectorAll('main a, main button')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<44).map(e=>e.textContent.trim())`);
      assert.deepEqual(small, [], `targets at ${width}`);
      if (width === 375) await shot("inicio-375");
    }
    await command("Emulation.clearDeviceMetricsOverride");
    checks.push("No horizontal overflow and targets ≥ 44 px at 375, 768, 1024 and 1440 px");

    assert.deepEqual(unknown, []);
    assert.ok(requests.every(days => [7, 30, 90].includes(days)));
    console.log(JSON.stringify({ checks, summaryRequests: requests.length, productionAccess: false, simulatedApi: true }, null, 2));
  }, { browser: "chrome", sandbox: false });
} catch (error) { console.error(error); process.exitCode = 1; }
