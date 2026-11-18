import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function verifyInventorySheet({ command, evaluate, click, fillSelector, poll, request, text, db, folder, base, setStage, pass }) {
  async function open(id = "") {
    await command("Page.navigate", { url: `${base}/dashboard/inventario/hoja${id ? `?batchId=${id}` : ""}` });
    await poll(() => evaluate("(()=>{const input=document.querySelector('input[aria-label=\"ID del lote\"]');return Boolean(input&&Object.keys(input).some(key=>key.startsWith('__reactProps$')));})()"), 60000);
    if (id) await poll(async () => (await text()).includes(`ID: ${id}`));
  }
  async function currentBatch() { const id = await evaluate("new URLSearchParams(location.search).get('batchId')"); assert.ok(id); const result = await request(`/inventory/batches/${id}`); assert.equal(result.status, 200); return result.body.result; }
  async function preview() { await click("Guardar y previsualizar"); await poll(async () => (await text()).includes("Vista previa calculada por el servidor.")); return currentBatch(); }
  async function fileInput(file) {
    const { root } = await command("DOM.getDocument"); const { nodeId } = await command("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="file"]' });
    await command("DOM.setFileInputFiles", { nodeId, files: [file] });
    await poll(async () => (await text()).includes("Confirmar asignación y cargar filas"), 60000);
    await click("Confirmar asignación y cargar filas"); await poll(() => evaluate("document.querySelectorAll('tbody tr').length>0"));
  }
  async function saveExport(format, filename) {
    const data = await evaluate(`(async()=>{const r=await fetch('/api/backend/inventory/export?format=${format}&limit=500&segment=true');return {status:r.status,bytes:[...new Uint8Array(await r.arrayBuffer())],count:r.headers.get('X-Inventory-Row-Count'),disposition:r.headers.get('Content-Disposition')}})()`);
    assert.equal(data.status, 200); assert.ok(data.disposition?.includes(`.${format}`)); assert.ok(Number(data.count) > 0);
    const file = path.join(folder, filename); await fs.writeFile(file, Buffer.from(data.bytes)); return file;
  }
  setStage("SHEET_REAL_GRID_PREVIEW_ATOMIC_CONFIRM_AND_RELOAD"); await open(); await click("Agregar fila");
  await fillSelector('[aria-label="SKU fila 2"]', "SHEET-001"); await fillSelector('[aria-label="Nombre fila 2"]', "Hoja real E2E"); await fillSelector('[aria-label="PrecioVentaCOP fila 2"]', "12000"); await fillSelector('[aria-label="CostoRefCOP fila 2"]', "4000"); await fillSelector('[aria-label="ExistenciaMinima fila 2"]', "2"); await fillSelector('[aria-label="ExistenciaObjetivo fila 2"]', "8"); await fillSelector('[aria-label="MotivoAjuste fila 2"]', "Conteo real de hoja");
  const ready = await preview(); assert.equal(ready.status, "READY"); assert.equal(await db.inventoryItem.count({ where: { sku: "SHEET-001" } }), 0);
  await click("Confirmar lote completo"); await poll(async () => (await text()).includes("Recibo persistido:"));
  const item = await db.inventoryItem.findFirstOrThrow({ where: { sku: "SHEET-001" } }); assert.equal(item.stock, 8); assert.equal((await db.itemCommercialTerms.findUniqueOrThrow({ where: { itemId: item.id } })).unitSalePrice, 12000n);
  await command("Page.reload", { ignoreCache: true }); await poll(async () => (await text()).includes("Recibo persistido:")); assert.equal(await db.inventoryMovement.count({ where: { batchId: ready.id } }), 1); pass();

  setStage("SHEET_REAL_XLSX_FILE_WORKER_ROUND_TRIP_NO_STOCK_CHANGE");
  const xlsxFile = await saveExport("xlsx", "inventory-roundtrip.xlsx"); assert.equal((await fs.readFile(xlsxFile)).readUInt32LE(0), 0x04034b50);
  await open(); await fileInput(xlsxFile); const xlsx = await preview(); assert.equal(xlsx.status, "READY"); assert.equal(xlsx.counts.adjustments, 0); assert.equal(xlsx.counts.modified, 0); assert.ok(xlsx.counts.unchanged > 0);
  await click("Confirmar lote completo"); await poll(async () => (await text()).includes("Recibo persistido:")); assert.equal(await db.inventoryMovement.count({ where: { batchId: xlsx.id } }), 0); pass();

  setStage("SHEET_REAL_CSV_FILE_ROUND_TRIP_AND_MOBILE_PAGINATION");
  const csvFile = await saveExport("csv", "inventory-roundtrip.csv");
  await open(); await fileInput(csvFile); const csv = await preview(); assert.equal(csv.status, "READY"); assert.equal(csv.counts.adjustments, 0);
  await click("Cancelar lote sin aplicar"); await poll(async () => (await text()).includes("Estado: CANCELLED"));
  await open();
  const source = "SKU\tNombre\tExistenciaObjetivo\tMotivoAjuste\n" + Array.from({ length: 52 }, (_, index) => `PASTE-${index}\tPegado ${index}\t1\tConteo pegado`).join("\n");
  await fillSelector("textarea", source); await click("Revisar columnas pegadas"); await click("Confirmar asignación y cargar filas"); await poll(() => evaluate("document.querySelectorAll('tbody tr').length===50"));
  setStage("SHEET_RECTANGULAR_COPY");
  await evaluate(`document.querySelector('[aria-label="SKU fila 2"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  await poll(() => evaluate("![...document.querySelectorAll('button')].find(e=>e.textContent==='Copiar selección rectangular').disabled"));
  await evaluate(`document.querySelector('[aria-label="Nombre fila 3"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,shiftKey:true}))`);
  await click("Copiar selección rectangular"); await poll(() => evaluate("document.querySelector('textarea[readonly]')?.value==='PASTE-0\\tPegado 0\\nPASTE-1\\tPegado 1'"));
  setStage("SHEET_RECTANGULAR_PASTE");
  await evaluate(`(()=>{const data=new DataTransfer();data.setData('text/plain','1000\\t500\\n1100\\t600');document.querySelector('[aria-label="PrecioVentaCOP fila 2"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));})()`);
  await poll(() => evaluate("document.querySelector('[aria-label=\"CostoRefCOP fila 3\"]')?.value==='600'"));
  await click("Editar fila 2"); await poll(() => evaluate("Boolean(document.querySelector('[aria-label=\"Edición ampliada fila 2\"]'))")); await click("Cerrar edición ampliada");
  setStage("SHEET_REAL_CSV_FILE_ROUND_TRIP_AND_MOBILE_PAGINATION");
  for (const width of [1280, 320, 390]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await click("Siguiente"); await poll(() => evaluate("document.querySelectorAll('tbody tr').length===2")); await click("Anterior"); await poll(() => evaluate("document.querySelectorAll('tbody tr').length===50"));
    assert.ok(await evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"));
    const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); await fs.writeFile(path.join(folder, `inventory-sheet-${width}.png`), Buffer.from(screenshot.data, "base64"));
  }
  const pasted = await preview(); assert.equal(pasted.status, "READY"); assert.equal(pasted.counts.new, 52); await click("Cancelar lote sin aplicar"); await poll(async () => (await text()).includes("Estado: CANCELLED")); pass();

  setStage("SHEET_REAL_ROW_ERRORS_EXCLUSION_AND_PREVIEW_REQUIRED"); await open();
  const invalidText = "SKU\tNombre\tExistenciaObjetivo\tMotivoAjuste\nVALID-SHEET\tVálida\t1\tConteo válido\nBAD-SHEET\tInválida\t-1\tConteo inválido";
  await fillSelector("textarea", invalidText); await click("Revisar columnas pegadas"); await click("Confirmar asignación y cargar filas"); await poll(() => evaluate("document.querySelectorAll('tbody tr').length===2"));
  const invalid = await preview(); assert.equal(invalid.status, "INVALID"); assert.ok((await text()).includes("Revisa el formato")); assert.equal(await db.inventoryItem.count({ where: { sku: "VALID-SHEET" } }), 0);
  await evaluate("document.querySelector('[aria-label=\"Incluir fila 3\"]').click()"); assert.ok(await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Confirmar lote completo').disabled"));
  const corrected = await preview(); assert.equal(corrected.status, "READY"); assert.equal(corrected.counts.excluded, 1);
  await click("Confirmar lote completo"); await poll(async () => (await text()).includes("Recibo persistido:")); assert.equal(await db.inventoryItem.count({ where: { sku: "VALID-SHEET" } }), 1); assert.equal(await db.inventoryItem.count({ where: { sku: "BAD-SHEET" } }), 0); pass();

  setStage("SHEET_REAL_LOST_COMMIT_RESPONSE_AND_PERSISTENT_RECEIPT");
  await open(); await click("Agregar fila"); await fillSelector('[aria-label="SKU fila 2"]', "LOST-SHEET"); await fillSelector('[aria-label="Nombre fila 2"]', "Respuesta perdida"); await fillSelector('[aria-label="ExistenciaObjetivo fila 2"]', "3"); await fillSelector('[aria-label="MotivoAjuste fila 2"]', "Conteo idempotente"); const lost = await preview();
  const recover = { expectedRevision: lost.revision, previewRevision: lost.previewRevision, planHash: lost.planHash, operationId: lost.applyOperationId };
  await command("Fetch.enable", { patterns: [{ urlPattern: `*/api/backend/inventory/batches/${lost.id}/apply`, requestStage: "Response" }] });
  // The enclosing runner's response-loss hook fails exactly one response after server commit.
  await evaluate("window.__inventorySheetLostResponse=true");
  // CDP event handling is supplied by the enclosing runner; enable its one-shot switch.
  await setStage("SHEET_REAL_LOST_COMMIT_RESPONSE_AND_PERSISTENT_RECEIPT", true);
  await click("Confirmar lote completo"); await poll(async () => (await text()).includes("No se pudo conectar con la API")); await command("Fetch.disable");
  assert.equal(await db.inventoryMovement.count({ where: { batchId: lost.id } }), 1);
  await command("Page.reload", { ignoreCache: true }); await poll(async () => (await text()).includes("Recibo persistido:"));
  const repeats = await Promise.all([request(`/inventory/batches/${lost.id}/apply`, "POST", recover), request(`/inventory/batches/${lost.id}/apply`, "POST", recover)]); assert.ok(repeats.every(result => result.status === 200)); assert.equal(await db.inventoryMovement.count({ where: { batchId: lost.id } }), 1); pass();

  setStage("SHEET_REAL_CONFLICT_ERROR_WITHOUT_PARTIAL_WRITES");
  const id = randomUUID(), rowId = randomUUID(); assert.equal((await request("/inventory/batches", "POST", { id, source: "GRID", totalRows: 1 })).status, 200);
  const stage = await request(`/inventory/batches/${id}/rows`, "PATCH", { chunkId: randomUUID(), expectedRevision: 1, totalRows: 1, rows: [{ rowId, rowNumber: 2, values: { id: item.id, targetStock: 12, reason: "Conteo conflictivo" } }] }); assert.equal(stage.status, 200);
  const before = await request(`/inventory/batches/${id}/preview`, "POST", { expectedRevision: stage.body.result.revision }); assert.equal(before.status, 200);
  assert.equal((await request(`/inventory/items/${item.id}/movements`, "POST", { key: randomUUID(), type: "IN", quantity: 1, reason: "Movimiento entre vista y confirmación" })).status, 200);
  await open(id); await click("Confirmar lote completo"); await poll(async () => (await text()).includes("El saldo o los datos cambiaron")); assert.equal(await db.inventoryMovement.count({ where: { batchId: id } }), 0); assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 9);
  await click("Guardar y previsualizar"); await poll(async () => (await text()).includes("Vista previa calculada por el servidor.")); await click("Confirmar lote completo"); await poll(async () => (await text()).includes("Recibo persistido:")); assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 12); pass();
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: `${base}/dashboard/inventario` }); await poll(() => evaluate("document.querySelector('h1')?.textContent==='Inventario'"));
  setStage("SHEET_TRADITIONAL_COMMERCIAL_AND_METADATA_EDIT_WITHOUT_STOCK_CHANGE");
  await poll(async () => (await text()).includes("Movimientos de Hoja real E2E")); await click("Movimientos de Hoja real E2E");
  await poll(() => evaluate("[...document.querySelectorAll('label')].find(e=>e.firstChild?.textContent==='Editar nombre')?.querySelector('input')?.value==='Hoja real E2E'"));
  const ledgerCount = await db.inventoryMovement.count({ where: { itemId: item.id } });
  await fillSelector('section[aria-label="Datos y ficha comercial"] input[maxlength="160"]', "Hoja con ficha editada"); await click("Guardar datos del producto"); await poll(async () => (await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).name === "Hoja con ficha editada");
  await fillSelector('section[aria-label="Datos y ficha comercial"] input[pattern="[0-9]+"]', "15000"); await click("Guardar ficha comercial"); await poll(async () => (await db.itemCommercialTerms.findUniqueOrThrow({ where: { itemId: item.id } })).unitSalePrice === 15000n);
  assert.equal(await db.inventoryMovement.count({ where: { itemId: item.id } }), ledgerCount); assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).stock, 12); pass();
  return ready.id;
}
