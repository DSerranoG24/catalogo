import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

export async function verifyFreeWorkbook({ command, evaluate, click, fillSelector, poll, request, text, db, folder, base, setStage, pass, inventoryWrites, ownerId }) {
  async function key(key, code, virtual, modifiers = 0) {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtual, modifiers });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtual, modifiers });
  }
  async function go(address) {
    await fillSelector('[data-u-comp="defined-name"] input', address);
    await evaluate("document.querySelector('[data-u-comp=\"defined-name\"] input').focus()");
    await key("Enter", "Enter", 13);
  }
  async function write(address, value) {
    await go(address); await key("F2", "F2", 113); await command("Input.insertText", { text: value }); await key("Enter", "Enter", 13);
  }
  async function drag(x, y, targetX, targetY) {
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    for (let step = 1; step <= 12; step++) await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + (targetX - x) * step / 12, y: y + (targetY - y) * step / 12, button: "left", buttons: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: targetX, y: targetY, button: "left", clickCount: 1 });
  }
  try {
    setStage("FREE_WORKBOOK_REAL_EDITOR_CUSTOM_TITLES_FORMULAS_AND_MANUAL_SAVE");
    const itemsBefore = await db.inventoryItem.count(), ledgerBefore = await db.inventoryMovement.count();
    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await command("Page.navigate", { url: `${base}/dashboard/inventario/hoja` });
    await poll(() => evaluate("Boolean(document.querySelector('[data-u-comp=\"defined-name\"] input'))"), 90000);
    await poll(() => evaluate("[...document.querySelectorAll('button')].some(e=>e.textContent==='Guardar hoja'&&!e.disabled)"));
    const initial = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await fs.writeFile(path.join(folder, "free-workbook-initial.png"), Buffer.from(initial.data, "base64"));
    const writesBefore = inventoryWrites.length;
    await write("A1", "Mis artículos a mi manera"); await write("B1", "Un título que eligió el vendedor");
    await write("A2", "2"); await write("A3", "3"); await write("C1", "=SUM(A2:A3)");
    await go("A1"); await key("b", "KeyB", 66, 2);
    assert.equal(inventoryWrites.length, writesBefore, "editing the SDK must not write to the API");
    await click("Guardar hoja"); await poll(async () => (await text()).includes("Hoja guardada · versión 1."));
    const saved = await db.inventoryWorkbook.findUniqueOrThrow({ where: { userId: ownerId } }), document = JSON.parse(saved.snapshot), sheet = document.sheets[document.sheetOrder[0]];
    assert.equal(sheet.cellData[0][0].v, "Mis artículos a mi manera"); assert.equal(sheet.cellData[0][1].v, "Un título que eligió el vendedor"); assert.equal(sheet.cellData[0][2].f, "=SUM(A2:A3)");
    assert.equal(sheet.cellData[0][2].v, 5);
    const bold = sheet.cellData[0][0].s; assert.equal((typeof bold === "string" ? document.styles[bold] : bold).bl, 1);
    assert.equal(await db.inventoryItem.count(), itemsBefore); assert.equal(await db.inventoryMovement.count(), ledgerBefore); pass();
    setStage("FREE_WORKBOOK_RELOAD_AND_PERSISTED_SAVE_RECEIPT");
    await command("Page.reload", { ignoreCache: true }); await poll(async () => (await text()).includes("Hoja recuperada · versión 1."), 90000);
    await poll(() => evaluate("Boolean(document.querySelector('[data-u-comp=\"defined-name\"] input'))"));
    await write("D1", "Otra columna propia"); await click("Guardar hoja"); await poll(async () => (await text()).includes("Hoja guardada · versión 2."));
    const latest = await request("/inventory/workbook"); assert.equal(latest.status, 200); assert.equal(latest.body.result.version, 2);
    const data = JSON.parse(latest.body.result.snapshot); assert.equal(data.sheets[data.sheetOrder[0]].cellData[0][0].v, "Mis artículos a mi manera"); assert.equal(data.sheets[data.sheetOrder[0]].cellData[0][3].v, "Otra columna propia");
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await fs.writeFile(path.join(folder, "free-workbook-edited.png"), Buffer.from(screenshot.data, "base64")); pass();
    setStage("FREE_WORKBOOK_REAL_DRAG_RESIZE_AND_MOVE_CELLS");
    await go("A1");
    const canvas = await evaluate("(()=>{const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];const r=c.getBoundingClientRect();return{x:r.x,y:r.y}})()");
    await drag(canvas.x + 134, canvas.y + 10, canvas.x + 214, canvas.y + 10);
    await go("A2");
    await drag(canvas.x + 130, canvas.y + 44, canvas.x + 46 + 168 + 3 * 88 + 44, canvas.y + 20 + 4 * 24 + 12);
    await click("Guardar hoja"); await poll(async () => (await text()).includes("Hoja guardada · versión 3."));
    const moved = JSON.parse((await request("/inventory/workbook")).body.result.snapshot); const movedSheet = moved.sheets[moved.sheetOrder[0]];
    assert.ok(movedSheet.columnData[0].w > 88); assert.equal(movedSheet.cellData[4][4].v, 2); assert.ok(!movedSheet.cellData[1]?.[0]?.v);
    const dragged = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await fs.writeFile(path.join(folder, "free-workbook-dragged.png"), Buffer.from(dragged.data, "base64")); pass();
    setStage("FREE_WORKBOOK_MULTIPLE_TABS_FIND_AND_SAVE");
    await evaluate("document.querySelector('[data-u-comp=\"sheet-bar-append-button\"]').click()");
    await poll(() => evaluate("document.querySelectorAll('[data-u-comp=\"slide-tab-item\"]').length===2"));
    await write("A1", "Datos en otra pestaña libre");
    await key("f", "KeyF", 70, 2); await poll(() => evaluate("Boolean(document.querySelector('input[placeholder=\"Buscar\"]'))"));
    await fillSelector('input[placeholder="Buscar"]', "Datos"); await key("Escape", "Escape", 27);
    await click("Guardar hoja"); await poll(async () => (await text()).includes("Hoja guardada · versión 4."));
    const tabs = JSON.parse((await request("/inventory/workbook")).body.result.snapshot); assert.equal(tabs.sheetOrder.length, 2); assert.equal(tabs.sheets[tabs.sheetOrder[1]].cellData[0][0].v, "Datos en otra pestaña libre");
    await command("Page.reload", { ignoreCache: true }); await poll(async () => (await text()).includes("Hoja recuperada · versión 4."), 90000); assert.equal(await evaluate("document.querySelectorAll('[data-u-comp=\"slide-tab-item\"]').length"), 2); pass();
    await command("Page.navigate", { url: `${base}/dashboard/inventario` }); await poll(() => evaluate("document.querySelector('h1')?.textContent==='Inventario'"));
  } catch (error) {
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }).catch(() => null); if (screenshot) await fs.writeFile(path.join(folder, "free-workbook-failure.png"), Buffer.from(screenshot.data, "base64"));
    const diagnostics = await evaluate("[...document.querySelectorAll('input,textarea,canvas')].map(e=>({tag:e.tagName,aria:e.getAttribute('aria-label'),component:e.getAttribute('data-u-comp'),type:e.type,rect:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}))").catch(() => []);
    await fs.writeFile(path.join(folder, "free-workbook-diagnostics.json"), JSON.stringify(diagnostics)); throw error;
  }
}
