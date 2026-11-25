import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Panel shell: side menu, avatar menu, mobile bar and «Más» sheet, Inicio and the catalog list at /dashboard/catalogos.
// Real Chromium and Next proxy, simulated API.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [], unknown = [];
const now = () => new Date().toISOString();
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  req.resume(); await new Promise(resolve => req.on("end", resolve));
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/me") return reply({ user: { email: "fixture@example.invalid", name: null, emailVerifiedAt: now(), hasLocalPassword: true } });
  if (url.pathname === "/api/catalogs") return reply({ catalogs: [] });
  if (url.pathname === "/api/sales") return reply({ result: [] });
  if (url.pathname === "/api/inventory/items") return reply({ success: true, result: { items: [], total: 0, page: 1 } });
  if (url.pathname === "/api/customers") return reply({ success: true, customers: [], hasMore: false, page: 1, pageSize: 25 });
  if (url.pathname === "/api/dashboard/summary") {
    // Empty account: the shell is under test here; Inicio's figures are covered by test:dashboard-browser.
    const days = Number(url.searchParams.get("days")), today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const series = Array.from({ length: days }, (_, i) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (days - 1) + i); return { date: d.toISOString().slice(0, 10), total: "0" }; });
    return reply({ success: true, generatedAt: now(), today: { date: today, salesTotal: "0", salesCount: 0, yesterdaySalesTotal: "0" },
      month: { salesTotal: "0", costOfSales: "0", salesWithoutCostCount: 0, expensesTotal: null, estimatedProfit: "0", previousMonth: { salesTotal: "0", expensesTotal: null, estimatedProfit: "0" } },
      attention: { lowStockCount: 0, outOfStockCount: 0, pendingOrdersCount: 0 }, salesSeries: series, recent: [],
      setup: { hasInventoryItems: false, hasPublishedCatalog: false, hasSales: false }, modules: { expenses: false } });
  }
  unknown.push(`${req.method} ${url.pathname}`); return reply({ message: "No disponible en la prueba." }, 404);
}

// Static scan: no internal link still uses /dashboard as the catalog list.
const allowed = new Map([["components/auth/AccountActionForm.tsx", "Ir al panel y reenviar (panel, not the list)"]]);
const offenders = [];
for (const dir of ["app", "components", "lib"]) {
  const walk = folder => { for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|mjs)$/.test(entry.name)) {
      const rel = path.relative(root, full).replaceAll("\\", "/");
      fs.readFileSync(full, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (/(href=|backHref:\s*)["'`]\/dashboard["'`]/.test(line) && !allowed.has(rel)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  } };
  walk(path.join(root, dir));
}
// The only remaining href="/dashboard" are the brand links to Inicio in the shell.
assert.deepEqual(offenders.filter(o => !o.startsWith("app/dashboard/layout.tsx") && !o.startsWith("components/panel/PanelSidebar.tsx")), [], "links still pointing to the old catalog list");
checks.push("Static scan: no href or backHref uses /dashboard as the catalog list (only brand links to Inicio and «Ir al panel»)");

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll }) => {
    const text = () => evaluate("document.body.innerText");
    const waitText = async value => { try { await poll(async () => (await text()).includes(value)); } catch { throw new Error(`Texto no encontrado: ${value}\n${(await text()).slice(0, 1200)}`); } };
    const viewport = async width => { await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await new Promise(r => setTimeout(r, 300)); };
    const visibleNav = `[...document.querySelectorAll('nav[aria-label="Principal"]')].find(n=>n.getClientRects().length)`;
    const pathname = () => evaluate("location.pathname");
    const key = async (name, code, vk) => { for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk, ...(name === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); };
    const shot = async name => {
      const folder = process.env.PANEL_SCREENSHOTS; if (!folder) return;
      const { data } = await command("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, "base64"));
    };

    // Desktop: Inicio, menu entries, groups, aria-current.
    await viewport(1440);
    await command("Page.navigate", { url: "http://localhost:4338/dashboard" });
    await waitText("Hola");
    const expectedDate = (() => { const t = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).replace(",", ""); return t.charAt(0).toUpperCase() + t.slice(1); })();
    await waitText(expectedDate);
    await evaluate(`localStorage.setItem('catalogo-session',JSON.stringify({user:{id:'fixture',email:'fixture@example.invalid',name:'Daniel Serrano'}}));window.dispatchEvent(new Event('catalogo-session-change'))`);
    await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Hola, Daniel'`));
    const labels = await evaluate(`[...${visibleNav}.querySelectorAll('a')].map(a=>a.textContent.trim())`);
    assert.deepEqual(labels, ["Inicio", "Vender", "Inventario", "Catálogo", "Gastos", "Ajustes"]);
    const sidebar = await evaluate(`${visibleNav}.closest('aside').innerText`);
    for (const absent of ["Servicio técnico", "Cartera", "Reportes"]) assert.ok(!sidebar.includes(absent), `${absent} must not be shown`);
    for (const group of ["Día a día", "Productos", "Dinero", "Análisis"]) assert.ok(sidebar.includes(group), group);
    assert.ok(sidebar.includes("Hagamos crecer tu negocio") && sidebar.includes("Con Vitrinaya, es más fácil"));
    assert.equal(await evaluate(`${visibleNav}.closest('aside').querySelectorAll('a,button,[tabindex]').length`), 7, "decorative card is not focusable (logo + 6 entries)");
    assert.equal(await evaluate(`[...document.querySelectorAll('header a')].filter(a=>a.textContent.includes('Nueva venta')&&a.getClientRects().length).length`), 0, "Inicio has its own «Nueva venta»");
    assert.equal(await evaluate(`[...document.querySelectorAll('main a')].find(a=>a.textContent.includes('Nueva venta'))?.getAttribute('href')`), "/dashboard/ventas");
    const quick = await evaluate(`[...document.querySelectorAll('section[aria-labelledby="quick-actions"] a')].map(a=>[a.textContent.trim(),a.getAttribute('href')])`);
    assert.deepEqual(quick, [["Registrar gasto", "/dashboard/gastos"], ["Agregar producto", "/dashboard/inventario"]], "«Registrar gasto» with the Gastos module");
    await waitText("Ventas hoy"); await waitText("Primeros pasos");
    await shot("panel-1440");
    checks.push(`Inicio: «Hola, Daniel», «${expectedDate}», Nueva venta, quick actions and the summary; menu Inicio/Vender/Inventario/Catálogo/Gastos/Ajustes in four groups, no Servicio técnico/Cartera/Reportes`);

    // Contrast on the navy menu.
    const contrast = await evaluate(`(()=>{
      const rgb=s=>s.match(/[\\d.]+/g).slice(0,3).map(Number);
      const lum=c=>{const [r,g,b]=c.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
      const ratio=(a,b)=>{const x=lum(rgb(a)),y=lum(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const aside=${visibleNav}.closest('aside');
      const active=aside.querySelector('[aria-current="page"]'), inactive=aside.querySelector('nav a:not([aria-current])'), group=aside.querySelector('nav p');
      return { active: ratio(getComputedStyle(active).color,getComputedStyle(active).backgroundColor), inactiveOnNavy700: ratio(getComputedStyle(inactive).color,'rgb(0,41,113)'), groupOnNavy700: ratio(getComputedStyle(group).color,'rgb(0,41,113)') };
    })()`);
    for (const [name, value] of Object.entries(contrast)) assert.ok(value >= 4.5, `${name} ${value}`);
    checks.push("Contrast: " + Object.entries(contrast).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", "));

    // Every entry navigates and is the only aria-current="page".
    for (const [label, href, marker] of [["Vender", "/dashboard/ventas", "Ventas"], ["Inventario", "/dashboard/inventario", "Inventario"], ["Catálogo", "/dashboard/catalogos", "Tus catálogos"], ["Gastos", "/dashboard/gastos", "Gastos"], ["Ajustes", "/dashboard/cuenta", "Configuración de cuenta"], ["Inicio", "/dashboard", "Hola"]]) {
      await evaluate(`[...${visibleNav}.querySelectorAll('a')].find(a=>a.textContent.trim()===${JSON.stringify(label)}).click()`);
      await poll(async () => (await pathname()) === href);
      await waitText(marker);
      assert.deepEqual(await evaluate(`[...${visibleNav}.querySelectorAll('[aria-current="page"]')].map(a=>a.textContent.trim())`), [label], `aria-current on ${label}`);
      const newSale = await evaluate(`[...document.querySelectorAll('header a')].some(a=>a.textContent.includes('Nueva venta')&&a.getClientRects().length)`);
      assert.equal(newSale, !["Vender", "Inicio"].includes(label), `header «Nueva venta» on ${label}`);
      if (label === "Catálogo") {
        assert.ok((await text()).includes("Crea un espacio para tus productos"), "catalog list (empty state) at /dashboard/catalogos");
        assert.equal(await evaluate(`[...document.querySelectorAll('main button')].some(b=>b.textContent.includes('Cerrar sesión'))`), false, "the list has no own logout button");
      }
      if (label === "Ajustes") assert.equal(await evaluate(`document.querySelector('[data-account-back-link]').getAttribute('href')`), "/dashboard/catalogos");
    }
    await evaluate(`[...${visibleNav}.querySelectorAll('a')].find(a=>a.textContent.trim()==='Catálogo').click()`); await poll(async () => (await pathname()) === "/dashboard/catalogos");
    await evaluate(`location.assign('/dashboard/catalogos/nuevo')`); await poll(async () => (await pathname()) === "/dashboard/catalogos/nuevo");
    await poll(() => evaluate(`[...document.querySelectorAll('main a')].some(a=>a.textContent.includes('Volver a catálogos'))`));
    assert.equal(await evaluate(`[...document.querySelectorAll('main a')].find(a=>a.textContent.includes('Volver a catálogos')).getAttribute('href')`), "/dashboard/catalogos");
    assert.equal(await evaluate(`${visibleNav}.querySelector('[aria-current="page"]').textContent.trim()`), "Catálogo", "sub-routes keep their entry active");
    checks.push("Each entry navigates to its page with a single aria-current; header «Nueva venta» hidden on Inicio and Vender; catalog list at /dashboard/catalogos without its own logout; back links to the list");

    // Skip link.
    await evaluate(`document.activeElement?.blur()`); await evaluate(`document.body.focus()`);
    await key("Tab", "Tab", 9);
    assert.equal(await evaluate(`document.activeElement?.textContent`), "Saltar al contenido");
    await key("Enter", "Enter", 13);
    await poll(() => evaluate(`location.hash==='#contenido'||document.activeElement?.id==='contenido'`));
    checks.push("«Saltar al contenido» is the first Tab stop and jumps to the content");

    // Avatar menu: opens with keyboard, shows the identity, Escape closes and returns focus, Ajustes, logout.
    await evaluate(`document.querySelector('button[aria-label="Menú de cuenta"]').focus()`);
    assert.equal(await evaluate(`document.querySelector('button[aria-label="Menú de cuenta"] span').textContent`), "F", "after a reload the fixture session has no name: the initial comes from the email");
    await key("Enter", "Enter", 13);
    await poll(() => evaluate(`document.querySelector('button[aria-label="Menú de cuenta"]').getAttribute('aria-expanded')==='true'`));
    assert.ok((await evaluate(`document.querySelector('#avatar-menu').innerText`)).includes("fixture@example.invalid"));
    assert.equal(await evaluate(`document.activeElement?.closest('#avatar-menu')!==null`), true, "focus moves into the menu");
    await key("Escape", "Escape", 27);
    await poll(() => evaluate(`!document.querySelector('#avatar-menu')&&document.activeElement?.getAttribute('aria-label')==='Menú de cuenta'`));
    await evaluate(`document.querySelector('button[aria-label="Menú de cuenta"]').click()`);
    await evaluate(`[...document.querySelectorAll('#avatar-menu a')].find(a=>a.textContent.trim()==='Ajustes').click()`);
    await poll(async () => (await pathname()) === "/dashboard/cuenta");
    assert.equal(await evaluate(`Boolean(document.querySelector('#avatar-menu'))`), false, "menu closes after navigating");
    checks.push("Avatar menu: initial, name/email only when open, keyboard open with focus inside, Escape returns focus, Ajustes navigates and closes");

    // Mobile: no sidebar; bottom bar Inicio/Vender/Inventario/Más; «Más» sheet with the rest and logout.
    await viewport(375);
    await evaluate(`location.assign('/dashboard')`); await poll(async () => (await pathname()) === "/dashboard");
    await waitText("Hola");
    assert.equal(await evaluate(`[...document.querySelectorAll('aside')].some(a=>a.getClientRects().length)`), false, "no side menu on mobile");
    assert.deepEqual(await evaluate(`[...${visibleNav}.querySelectorAll('a,button')].map(e=>e.textContent.trim())`), ["Inicio", "Vender", "Inventario", "Más"]);
    assert.equal(await evaluate(`getComputedStyle(${visibleNav}).position`), "fixed");
    assert.ok(await evaluate(`(()=>{const pad=parseFloat(getComputedStyle(document.querySelector('#contenido').parentElement).paddingBottom);return pad>=${visibleNav}.getBoundingClientRect().height-1})()`), "content is padded above the bottom bar");
    await shot("panel-375");
    await evaluate(`[...${visibleNav}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Más').focus()`);
    await key("Enter", "Enter", 13);
    await poll(() => evaluate(`Boolean(document.querySelector('[role="dialog"]'))`));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[role="dialog"] li')].map(li=>li.textContent.trim())`), ["Catálogo", "Gastos", "Ajustes", "Cerrar sesión"]);
    await shot("panel-375-mas");
    await key("Escape", "Escape", 27);
    await poll(() => evaluate(`!document.querySelector('[role="dialog"]')&&document.activeElement?.textContent.trim()==='Más'`));
    await evaluate(`[...${visibleNav}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Más').click()`);
    await poll(() => evaluate(`Boolean(document.querySelector('[role="dialog"]'))`));
    await evaluate(`[...document.querySelectorAll('[role="dialog"] a')].find(a=>a.textContent.trim()==='Catálogo').click()`);
    await poll(async () => (await pathname()) === "/dashboard/catalogos");
    await poll(() => evaluate(`!document.querySelector('[role="dialog"]')`));
    checks.push("Mobile: no side menu, fixed bottom bar Inicio/Vender/Inventario/Más with content padding; «Más» sheet with Catálogo, Gastos, Ajustes and Cerrar sesión, Escape returns focus, links navigate and close");

    // Layout: no overflow and touch targets ≥ 44 px on every page and width.
    for (const width of [375, 768, 1024, 1440]) {
      await viewport(width);
      for (const page of ["/dashboard", "/dashboard/catalogos", "/dashboard/ventas", "/dashboard/inventario", "/dashboard/gastos", "/dashboard/cuenta"]) {
        await evaluate(`location.assign(${JSON.stringify(page)})`); await poll(async () => (await pathname()) === page);
        await poll(() => evaluate(`!document.body.innerText.includes('Verificando sesión')`));
        await new Promise(r => setTimeout(r, 250));
        const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
        assert.ok(overflow <= 0, `overflow ${overflow}px on ${page} at ${width}`);
        const small = await evaluate(`[...document.querySelectorAll('nav[aria-label="Principal"] a, nav[aria-label="Principal"] button, header a, header button')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<44).map(e=>e.textContent.trim()||e.getAttribute('aria-label'))`);
        assert.deepEqual(small, [], `touch targets on ${page} at ${width}`);
      }
    }
    checks.push("No horizontal overflow and shell targets ≥ 44 px on Inicio, Catálogo, Vender, Inventario, Gastos and Ajustes at 375, 768, 1024 and 1440 px");

    // Logout from the avatar menu.
    await viewport(1440);
    await evaluate(`location.assign('/dashboard')`); await poll(async () => (await pathname()) === "/dashboard");
    await poll(() => evaluate(`Boolean(document.querySelector('button[aria-label="Menú de cuenta"]'))`));
    // Server logout fails: stay on the page with an alert and keep the session.
    await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*", "*/api/backend/auth/logout"] });
    await evaluate(`document.querySelector('button[aria-label="Menú de cuenta"]').click()`);
    await evaluate(`[...document.querySelectorAll('#avatar-menu button')].find(b=>b.textContent==='Cerrar sesión').click()`);
    await poll(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes('No se pudo cerrar la sesión del servidor')`));
    assert.equal(await pathname(), "/dashboard"); assert.notEqual(await evaluate(`localStorage.getItem('catalogo-session')`), null);
    await command("Network.setBlockedURLs", { urls: ["*accounts.google.com/*", "*fonts.googleapis.com/*", "*fonts.gstatic.com/*"] });
    // Keyboard logout from the avatar menu.
    await evaluate(`void (document.querySelector('#avatar-menu') || document.querySelector('button[aria-label="Menú de cuenta"]').click())`);
    await poll(() => evaluate(`Boolean(document.querySelector('#avatar-menu'))`));
    await evaluate(`[...document.querySelectorAll('#avatar-menu button')].find(b=>b.textContent==='Cerrar sesión').focus()`);
    await key("Enter", "Enter", 13);
    await poll(async () => (await pathname()) === "/login");
    // The Next proxy answers /auth/logout itself by expiring the HttpOnly cookie.
    assert.ok(!(await command("Network.getCookies", { urls: ["http://localhost:4338/"] })).cookies.some(c => c.name === "catalogo_session"), "session cookie removed");
    assert.equal(await evaluate(`localStorage.getItem('catalogo-session')`), null);
    checks.push("Cerrar sesión from the avatar menu: a failed server logout shows role=alert and keeps the session; by keyboard it calls the same-origin logout (cookie expired), clears local metadata and goes to /login");

    // Without session (another origin, no stored metadata): redirect to /login.
    await command("Page.navigate", { url: "http://127.0.0.1:4338/dashboard/catalogos" });
    await poll(async () => (await pathname()) === "/login");
    checks.push("Without a session the panel redirects to /login");

    console.log(JSON.stringify({ checks, unknownApiCalls: [...new Set(unknown)], productionAccess: false, simulatedApi: true }, null, 2));
  }, { browser: "chrome", sandbox: false });
} catch (error) { console.error(error); process.exitCode = 1; }
