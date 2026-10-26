import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { auditThemeContrast } from "./public-theme-contrast.mjs";

const templates = ["TECH", "FASHION", "BEAUTY", "GLAMOUR", "EDITORIAL", "GRID", "BOUTIQUE"];
const widths = [320, 390, 1024, 1440];
export function themeFixture(catalog, publicId) {
  const [template, preset] = publicId.split("~");
  const category = { id: "category", name: "Selección", slug: "seleccion", imageUrl: null, position: 0 };
  const products = Array.from({ length: 21 }, (_, i) => ({ ...catalog.products[0], id: `p${i + 1}`, slug: `producto-${i}`,
    name: `Producto local ${i + 1}`, categoryId: category.id, category: { id: category.id, name: category.name },
    regularPrice: i === 1 ? 2000 : null, discountPercent: i === 1 ? 50 : null,
    saleEndsAt: i === 1 ? "2099-01-01T00:00:00.000Z" : null, images: [] }));
  return { ...catalog, publicId, template, themePreset: preset === "absent" ? undefined : preset ?? null,
    whatsappPhone: "+573000000000", phone: "+573000000000", businessHours: "Lunes a viernes", categories: [category], products };
}

// Ignore only the separately authorized WhatsApp change and nonvisual DOM/custom properties.
const snapshotExpression = `(()=>{const properties=['color','background-color','background-image','border-top-color','border-right-color','border-bottom-color','border-left-color','box-shadow','opacity','outline-color','outline-width','font-family','font-size','font-weight','line-height','width','height','padding','margin','display','gap','grid-template-columns','border-radius'];return [...document.querySelectorAll('main,main *')].filter(e=>!['SCRIPT','STYLE'].includes(e.tagName)&&!e.closest('a[href^="https://wa.me/"]')).map(e=>{const s=getComputedStyle(e);return [e.tagName,...properties.map(p=>s.getPropertyValue(p))]})})()`;

export async function verifyPublicThemes({ command, evaluate, poll, pause, base, folder }) {
  const recordAt = process.argv.indexOf("--record-theme-baseline");
  const compareAt = process.argv.indexOf("--theme-baseline");
  const recording = recordAt >= 0;
  assert.ok(recording || compareAt >= 0, "A pre-change baseline is required");
  const baseline = recording ? {} : JSON.parse(fs.readFileSync(process.argv[compareAt + 1], "utf8"));
  let comparisons = 0;
  await command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  async function navigate(id, kind) {
    await command("Page.navigate", { url: `${base}/c/${id}` });
    await poll(() => evaluate(`Boolean(document.querySelector('[data-product-card]'))`));
    if (kind.startsWith("cart")) {
      await evaluate(`sessionStorage.setItem(${JSON.stringify(`catalogo-cart-${id}`)},${JSON.stringify(kind === "cart-full" ? '{"p1":2,"p2":1}' : '{}')})`);
      await command("Page.navigate", { url: `${base}/c/${id}/carrito` });
      await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Carrito'&&Boolean(document.querySelector(${JSON.stringify(kind === "cart-full" ? "form" : "main section h2")}))`));
    } else if (kind === "detail") {
      await command("Page.navigate", { url: `${base}/c/${id}/producto/producto-1` });
      await poll(() => evaluate(`Boolean(document.getElementById('reviews-heading'))`));
    }
    await evaluate("document.fonts.ready.then(()=>true)");
    await pause(70);
  }
  async function measure() {
    const html = await (await fetch(`${base}/c/FASHION`)).text();
    const urls = [...new Set([...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)]
      .filter(m => m[2].startsWith('/_next/') && !/nomodule/i.test(m[1] + m[3])).map(m => m[2]))];
    let bytes = 0, gzip = 0;
    for (const url of urls) { const data = fs.readFileSync('.next' + url.replace('/_next', '')); bytes += data.length; gzip += gzipSync(data).length; }
    return { bytes, gzip, scripts: urls };
  }
  const weight = await measure();
  const resolverChunks = fs.readdirSync(".next/static/chunks").filter(file => file.endsWith(".js"))
    .filter(file => fs.readFileSync(`.next/static/chunks/${file}`, "utf8").includes('"#FCD34D"'))
    .map(file => { const data = fs.readFileSync(`.next/static/chunks/${file}`); return { file, bytes: data.length, gzip: gzipSync(data).length }; });
  if (!recording) {
    assert.ok(resolverChunks.length >= 1, "Deferred resolver variants exist");
    assert.ok(weight.scripts.every(url => !resolverChunks.some(chunk => url.endsWith(chunk.file))), "Null catalog excludes palettes from initial JS");
  }
  async function normalizeColors(snapshot) {
    // CSS variables retain color-mix(), while the optimizer folds static colors to Lab.
    // Compare rendered sRGB channels, not equivalent CSS serialization formats.
    return evaluate(`(()=>{const rows=${JSON.stringify(snapshot)};const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});for(const row of rows)for(const i of [1,2,4,5,6,7,10]){ctx.clearRect(0,0,1,1);ctx.fillStyle=row[i];ctx.fillRect(0,0,1,1);row[i]=Array.from(ctx.getImageData(0,0,1,1).data)}return rows})()`);
  }
  const reviewRegressions = [];
  async function expectedSnapshot(expected, actual, kind) {
    if (kind !== "detail") return expected;
    const index = await evaluate(`[...document.querySelectorAll('main,main *')].filter(e=>!['SCRIPT','STYLE'].includes(e.tagName)&&!e.closest('a[href^="https://wa.me/"]')).indexOf(document.querySelector('button[type="submit"]'))`);
    assert.ok(index >= 0 && expected[index]?.[0] === "BUTTON", "Historical review action identified");
    // Only its authorized text/currentColor change is exempt; geometry/background stay exact.
    return expected.map((row, i) => i === index ? row.map((value, column) => [1, 4, 5, 6, 7, 10].includes(column) ? actual[i][column] : value) : row);
  }
  async function verifyReview(template, width) {
    for (const state of ["normal", "hover", "focus"]) {
      const selector = 'button[type="submit"]';
      await evaluate(`document.querySelector('${selector}').scrollIntoView({block:'center'})`);
      if (state === "hover") {
        const point = await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      } else {
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
        if (state === "focus") await evaluate(`document.querySelector('${selector}').focus()`);
      }
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
      const audit = await evaluate(`(${auditThemeContrast.toString()})(${JSON.stringify(selector)},false)`);
      assert.deepEqual(audit.failures, [], `${template}/${width}/NULL/review/${state}: contrast`);
      assert.ok(audit.minimum >= 4.5);
      reviewRegressions.push({ template, width, state, contrast: audit.minimum });
    }
  }
  for (const template of process.argv.includes("--theme-palettes-only") ? [] : templates) {
    for (const width of widths) {
      await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      for (const kind of ["catalog", "detail", "cart-empty", "cart-full"]) {
        const key = `${template}:${width}:${kind}`;
        await navigate(template, kind);
        const snapshot = await evaluate(snapshotExpression);
        if (recording) baseline[key] = snapshot;
        else {
          const actual = await normalizeColors(snapshot), expected = await normalizeColors(await expectedSnapshot(baseline[key], snapshot, kind));
          const mismatch = actual.findIndex((row, i) => JSON.stringify(row) !== JSON.stringify(expected[i]));
          if (mismatch >= 0 || actual.length !== expected.length) {
            console.error(JSON.stringify({ key, index: mismatch, actual: snapshot[mismatch], expected: baseline[key][mismatch] }));
            assert.fail(`${key}: NULL preset must preserve computed styles`);
          }
        }
        comparisons++;
        if (!recording && kind === "detail") await verifyReview(template, width);
      }
    }
    console.log(`PASS ${template}: null preset, catalog/detail/empty+full cart, four widths`);
  }
  if (recording) {
    baseline.weight = weight;
    fs.writeFileSync(process.argv[recordAt + 1], JSON.stringify(baseline));
  }
  const paletteResults = [];
  let fallbackComparisons = 0;
  if (!recording) {
    if (!process.argv.includes("--theme-palettes-only")) {
      await command("Emulation.setDeviceMetricsOverride", { width: 320, height: 1000, deviceScaleFactor: 1, mobile: false });
      const fallbackCases = templates.flatMap(template => ["absent", "unknown"].map(preset => [template, preset])).concat([["TECH", "forest"], ["GRID", "forest"]]);
      for (const [template, preset] of fallbackCases) {
        for (const kind of ["catalog", "detail", "cart-empty", "cart-full"]) {
          await navigate(`${template}~${preset}`, kind);
          assert.equal(await evaluate("document.querySelector('main').hasAttribute('data-catalog-themed')"), false);
          const actual = await evaluate(snapshotExpression);
          assert.deepEqual(await normalizeColors(actual), await normalizeColors(await expectedSnapshot(baseline[`${template}:320:${kind}`], actual, kind)), `${template}/${preset}/${kind}: unknown/absent/incompatible preset retains legacy appearance`);
          fallbackComparisons++;
        }
      }
      console.log(`PASS ${fallbackComparisons} absent/unknown/incompatible fallback comparisons`);
    }
    const presets = ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber"];
    for (const template of ["TECH", "FASHION", "BEAUTY", "GLAMOUR"]) {
      for (const preset of presets) {
        if (template === "TECH" && !preset.startsWith("night-")) continue;
        const caseAt = process.argv.indexOf("--theme-case");
        if (caseAt >= 0 && process.argv[caseAt + 1] !== `${template}/${preset}`) continue;
        let checked = 0, states = 0, minimumTextContrast = Infinity;
        for (const width of widths) {
          await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
          for (const kind of ["catalog", "detail", "cart-empty", "cart-full"]) {
            await navigate(`${template}~${preset}`, kind);
            const loadedResolver = await evaluate(`performance.getEntriesByType('resource').some(r=>${JSON.stringify(resolverChunks.map(chunk => chunk.file))}.some(file=>r.name.includes(file)))`);
            assert.equal(loadedResolver, kind.startsWith("cart"), "Only themed carts download the palette registry; catalog/detail resolve on server");
            assert.equal(await evaluate(`new Set(performance.getEntriesByType('resource').flatMap(r=>${JSON.stringify(resolverChunks.map(chunk => chunk.file))}.filter(file=>r.name.includes(file)))).size`), kind.startsWith("cart") ? 1 : 0, "A themed cart downloads one optimized variant, never both");
            assert.ok(await evaluate(`document.querySelector('main').dataset.catalogThemed==='true'`), `${template}/${preset}/${kind}: applied`);
            assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), `${template}/${preset}/${width}/${kind}: viewport fits`);
            const contrast = await evaluate(`(${auditThemeContrast.toString()})()`);
            assert.deepEqual(contrast.failures, [], `${template}/${preset}/${width}/${kind}: contrast`);
            checked += contrast.checked;
            if (Number.isFinite(contrast.minimum)) minimumTextContrast = Math.min(minimumTextContrast, contrast.minimum);
            const selectors = kind === "catalog" ? ['[data-product-card] button', 'a[href="#productos"]', 'nav[aria-label="Filtrar por categoría"] button:nth-child(2)', 'input[type="search"]', 'select', 'button[aria-label="Página siguiente"]']
              : kind === "detail" ? ['button[type="submit"]', 'button[aria-label="1 estrella"]', 'input[maxlength="60"]', 'button + a']
              : kind === "cart-full" ? ['button[type="submit"]', 'input[autocomplete="name"]', 'button[aria-label^="Quitar una unidad"]', 'button[aria-label^="Añadir una unidad"]'] : ['main section a'];
            selectors.push('a[href^="https://wa.me/"]');
            for (const selector of selectors) {
              if (!await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) continue;
              for (const state of ["hover", "focus-visible"]) {
                await evaluate(`document.activeElement?.blur();document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center'})`);
                if (state === "hover") {
                  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
                  await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
                } else {
                  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
                  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
                  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
                }
                await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))");
                const audit = await evaluate(`(${auditThemeContrast.toString()})(${JSON.stringify(selector)})`);
                if (audit.failures.length) console.error(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e);return JSON.stringify({selector:${JSON.stringify(selector)},state:${JSON.stringify(state)},hover:e.matches(':hover'),focus:e.matches(':focus-visible'),outline:s.outlineColor,background:s.backgroundColor,color:s.color,classes:e.className,children:[...e.children].map(c=>({color:getComputedStyle(c).color}))})})()`));
                assert.deepEqual(audit.failures, [], `${template}/${preset}/${width}/${kind}/${selector}/${state}: contrast`);
                if (state === "focus-visible") assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).outlineWidth)>=2`), "Visible keyboard focus");
                checked += audit.checked; states++;
                if (Number.isFinite(audit.minimum)) minimumTextContrast = Math.min(minimumTextContrast, audit.minimum);
              }
              await evaluate("document.activeElement?.blur()");
            }
            if (width === 390 && kind === "catalog") {
              const shot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
              fs.writeFileSync(path.join(folder, `${template}-${preset}.png`), Buffer.from(shot.data, "base64"));
            }
          }
        }
        paletteResults.push({ template, preset, widths, views: 16, checkedPairs: checked, interactionStates: states, minimumTextContrast });
        console.log(`PASS ${template}/${preset}: 16 views, ${states} hover/focus states, ${checked} text pairs`);
      }
    }
  }
  const report = { recording, comparisons, fallbackComparisons, reviewRegressions, weight, previousWeight: baseline.weight, resolverChunks, paletteResults, artifacts: path.resolve(folder) };
  if (!recording) fs.writeFileSync(path.join(folder, "theme-results.json"), JSON.stringify(report, null, 2));
  return report;
}
