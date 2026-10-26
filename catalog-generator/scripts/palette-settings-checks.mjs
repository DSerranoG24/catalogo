import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { auditThemeContrast } from "./public-theme-contrast.mjs";
import { measureSettingsJavaScript } from "./measure-settings-js.mjs";

const values = ["forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber"];
const names = ["Predeterminado", "Bosque", "Océano", "Terracota", "Rosa", "Violeta", "Grafito", "Menta noche", "Ámbar noche"];
const group = '[role="radiogroup"][aria-labelledby="catalog-palette-title"]';
const input = value => `${group} input[value=${JSON.stringify(value ?? "")}]`;

export async function verifyPaletteSettings({ command, evaluate, poll, pause, fill, clickText, base, folder, saves }) {
  const results = [];
  const initialJavaScript = await measureSettingsJavaScript(base);
  const review = async label => {
    const audit = await evaluate(`(${auditThemeContrast.toString()})(${JSON.stringify(group)})`);
    assert.deepEqual(audit.failures, [], label + " selector text contrast");
    return audit.minimum;
  };
  const key = async (key, modifiers = 0) => {
    const windowsVirtualKeyCode = { Tab: 9, Enter: 13, ArrowLeft: 37, ArrowRight: 39, " ": 32 }[key];
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code: key === " " ? "Space" : key, modifiers, windowsVirtualKeyCode, ...([" ", "Enter"].includes(key) ? { text: key === "Enter" ? "\r" : " " } : {}) });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code: key === " " ? "Space" : key, modifiers, windowsVirtualKeyCode });
  };
  async function choose(value) {
    const count = saves.length;
    await evaluate(`document.querySelector(${JSON.stringify(input(value))}).click()`);
    await poll(() => evaluate(`document.querySelector(${JSON.stringify(input(value))}).checked`));
    assert.equal(saves.length, count, "Choosing only changes the draft");
    assert.ok(await evaluate(`(()=>{const label=document.querySelector(${JSON.stringify(input(value))}).closest('label');const [swatches,preview]=label.querySelectorAll('[aria-hidden=true]');if(swatches.children.length!==4)return false;if(${JSON.stringify(value)}===null)return !preview.style.getPropertyValue('--catalog-background');const cards=preview.lastElementChild;return getComputedStyle(preview).backgroundColor===getComputedStyle(swatches.children[0]).backgroundColor&&getComputedStyle(cards.children[0]).backgroundColor===getComputedStyle(swatches.children[1]).backgroundColor&&getComputedStyle(cards.children[0].lastElementChild).backgroundColor===getComputedStyle(swatches.children[2]).backgroundColor})()`), "Four swatches and preview match resolved background/surface/primary");
  }
  async function save(template, preset, keyboard = false) {
    const count = saves.length;
    if (keyboard) {
      await evaluate("document.querySelector('form button[type=submit]').focus()");
      await key("Enter");
    } else await evaluate("document.querySelector('form button[type=submit]').click()");
    await poll(() => saves.length === count + 1);
    await poll(() => evaluate(`!document.querySelector('form button[type=submit]').disabled&&document.body.textContent.includes('Cambios guardados.')`));
    assert.equal(saves.at(-1).template, template);
    assert.equal(saves.at(-1).themePreset, preset);
    assert.ok(await evaluate("window.__paletteForm===document.querySelector('form')&&window.__paletteName===document.querySelector('form input[required][maxlength=\"100\"]')"), "Saving never remounts form or name field");
  }
  async function template(index) {
    await evaluate(`document.querySelectorAll('[role="radiogroup"][aria-label="Plantilla del catálogo"] button')[${index}].click()`);
  }
  await command("Accessibility.enable");
  for (const width of [320, 390, 1024, 1440]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    await command("Page.navigate", { url: `${base}/dashboard/catalogos/local-catalog` });
    await poll(() => evaluate(`Boolean(document.querySelector('input[placeholder="Ej. Lámpara de mesa"]'))`));
    await clickText("Tienda y diseño");
    await poll(() => evaluate(`document.querySelectorAll('${group} input').length===9&&!document.querySelector('${group} input[value=""]').disabled`));
    await evaluate("window.__paletteForm=document.querySelector('form');window.__paletteName=document.querySelector('form input[required][maxlength=\"100\"]');true");
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"), width + " fits");
    for (const [index, id] of [[1, "FASHION"], [2, "BEAUTY"], [3, "GLAMOUR"], [0, "TECH"]]) {
      await template(index);
      const compatible = id === "TECH" ? values.slice(6) : values;
      for (const preset of compatible) { await choose(preset); await save(id, preset); }
      await choose(null); await save(id, null);
      const { nodes } = await command("Accessibility.getFullAXTree");
      assert.ok(nodes.some(node => node.role?.value === "radiogroup" && node.name?.value === "Colores de tu catálogo"));
      const radios = nodes.filter(node => node.role?.value === "radio" && names.includes(node.name?.value));
      assert.equal(radios.length, 9, "All palettes have accessible radio names");
      assert.equal(radios.filter(node => node.properties.some(p => p.name === "checked" && p.value.value === "true")).length, 1);
      const unavailable = radios.filter(node => node.properties.some(p => p.name === "disabled" && p.value.value === true));
      assert.equal(unavailable.length, id === "TECH" ? 6 : 0);
      for (const radio of unavailable) assert.ok(radio.description?.value.includes("Esta paleta todavía no está disponible para el diseño Tecnología"));
      const minimum = await review(`${id}/${width}`);
      await evaluate(`document.querySelector(${JSON.stringify(input(null))}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(input(null))}).focus()`);
      assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(input(null))}).closest('label')).outlineWidth)>=2`));
      await review(`${id}/${width}/focus`);
      assert.deepEqual((await evaluate(`(${auditThemeContrast.toString()})('label:has(input[name="themePreset"][value=""])')`)).failures, [], "Computed option focus contrast");
      await key("ArrowRight");
      await poll(() => evaluate(`document.querySelector(${JSON.stringify(input(id === "TECH" ? "night-mint" : "forest"))}).checked`));
      await key("ArrowLeft");
      await poll(() => evaluate(`document.querySelector(${JSON.stringify(input(null))}).checked`));
      const hoverValue = id === "TECH" ? "forest" : null;
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(input(hoverValue))}).closest('label');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await review(`${id}/${width}/hover incl disabled`);
      results.push({ id, width, saves: compatible.length + 1, accessibleNames: true, unavailable: unavailable.length, minimumTextContrast: minimum });
      console.log(`PASS palette ${id}/${width}: save, native arrows and contrast`);
    }

    // Preserve a persisted palette, then reject an incompatible template draft.
    await template(1); await choose("forest"); await save("FASHION", "forest");
    await fill('form input[required][maxlength="100"]', "Marca sin guardar");
    await template(0);
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(input("forest"))}).checked&&document.querySelector(${JSON.stringify(input("forest"))}).disabled&&document.querySelector('form button[type=submit]').disabled&&document.getElementById('catalog-palette-warning').textContent.includes('Tu selección se conserva')`));
    const count = saves.length;
    await evaluate("document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await pause(100);
    assert.equal(saves.length, count, "Even a forced submit cannot save an incompatible draft");
    await review(`TECH incompatible ${width}`);
    await choose("night-mint"); await save("TECH", "night-mint");
    await fill('form input[required][maxlength="100"]', "Otro borrador conservado");
    await choose("night-amber");
    await clickText("Restablecer colores");
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(input("night-mint"))}).checked&&window.__paletteForm===document.querySelector('form')&&window.__paletteName.value==='Otro borrador conservado'`), "Reset keeps persisted palette and unrelated draft");

    await template(1); await choose(null);
    await evaluate(`document.querySelector(${JSON.stringify(input(null))}).focus()`);
    await key("ArrowRight");
    await poll(() => evaluate(`document.querySelector(${JSON.stringify(input("forest"))}).checked`));
    await key("ArrowLeft");
    await poll(() => evaluate(`document.querySelector(${JSON.stringify(input(null))}).checked`));
    await evaluate(`document.querySelector(${JSON.stringify(input("ocean"))}).focus()`);
    await key(" ");
    await poll(() => evaluate(`document.querySelector(${JSON.stringify(input("ocean"))}).checked`));
    assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector(${JSON.stringify(input("ocean"))}).closest('label')).outlineWidth)>=2`), "Visible focus on option");
    await review(`focused ${width}`);
    await key("Tab");
    assert.ok(await evaluate("document.activeElement.textContent.includes('Restablecer colores')"), "Tab leaves radio group");
    await key("Tab", 8);
    assert.ok(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(input("ocean"))})`), "Shift+Tab returns to the checked radio");
    const box = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(input("ocean"))}).closest('label').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
    await review(`hover ${width}`);
    await choose("night-amber");
    await clickText("Restablecer colores");
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(input("night-mint"))}).checked&&window.__paletteName.value==='Otro borrador conservado'`));
    await save("FASHION", "night-mint", true);
    assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth"));
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(folder, `palette-settings-${width}.png`), Buffer.from(screenshot.data, "base64"));
    console.log(`PASS palette settings ${width}: save/reset, incompatible draft, native keyboard, accessibility tree, contrast`);
  }
  const report = { results, savedRequests: saves.length, initialJavaScript, externalBackend: false, artifacts: folder, screenReader: "Chromium accessibility tree; physical assistive technology not exercised" };
  fs.writeFileSync(path.join(folder, "palette-settings-results.json"), JSON.stringify(report, null, 2));
  return report;
}
