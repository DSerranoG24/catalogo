"use client";
import { useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { columnName, previewWorkbookReading, readingFields, readWorkbookSnapshot, suggestReadingFields, type ReadingBook, type ReadingField, type ReadingSheet } from "@/lib/workbook-reading";
const labels: Record<ReadingField, string> = { ignore: "No interpretar", name: "Nombre del producto", sku: "SKU / código (texto)", quantity: "Cantidad (solo informativa)", unitSalePrice: "Precio de venta COP", referenceUnitCost: "Costo de referencia COP", minimumStock: "Existencia mínima" };
type ServerRow = { rowNumber: number; classification: "NEW" | "POTENTIAL_UPDATE" | "UNCHANGED" | "ERROR" | "EMPTY"; canApply: false; values: Record<string, string>; stockCurrent: number; stockTarget: number | null; delta: number; errors: { field: string; code: string; message: string }[] };
type ServerResult = { workbookVersion: number; rows: ServerRow[]; canApply: false };
export default function WorkbookReading({ getSnapshot, getActiveSheetId, getSavedReference, ready }: { getSnapshot: () => Promise<string>; getActiveSheetId: () => string | null; getSavedReference: () => { workbookId: string; version: number | null; dirty: boolean }; ready: boolean }) {
  const [book, setBook] = useState<ReadingBook | null>(null), [sheetId, setSheetId] = useState("");
  const [header, setHeader] = useState(1), [first, setFirst] = useState(2), [last, setLast] = useState(2), [mapping, setMapping] = useState<ReadingField[]>([]);
  const [result, setResult] = useState<ReturnType<typeof previewWorkbookReading> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [page, setPage] = useState(1);
  const [serverResult, setServerResult] = useState<ServerResult | null>(null), [serverBusy, setServerBusy] = useState(false), [applyBusy, setApplyBusy] = useState(false);
  const applyKeys = useRef<{ batchId: string; operationId: string } | null>(null);
  const capturing = useRef(false);
  const sheet = book?.sheets.find(value => value.id === sheetId);
  const used = sheet ? [...new Set(Object.values(sheet.cells).flatMap(row => Object.entries(row).filter(([, cell]) => cell.formula || (cell.value !== null && String(cell.value).trim() !== "")).map(([column]) => Number(column))))].sort((a, b) => a - b) : [];
  function choose(selected: ReadingSheet) {
    setSheetId(selected.id); setHeader(1); setFirst(2);
    const lastUsed = Math.max(2, ...Object.keys(selected.cells).map(row => Number(row) + 1));
    setLast(Math.min(selected.rowCount, lastUsed, 501)); setMapping(suggestReadingFields(selected, 1)); setResult(null); setPage(1);
  }
  async function serverPreview() {
    setError(""); setServerResult(null); const saved = getSavedReference();
    if (saved.dirty) { setError("Guarda la hoja antes de pedir la vista previa autoritativa."); return; }
    if (saved.version === null || !sheet) { setError("La hoja todavía no tiene una versión guardada."); return; }
    setServerBusy(true);
    try {
      const columnMapping = Object.fromEntries(mapping.map((field, column) => [String(column), field === "quantity" ? "quantity" : field]));
      const response = await apiRequest<{ result: ServerResult }>("/inventory/workbook/preview", { method: "POST", body: JSON.stringify({ workbookId: saved.workbookId, sheetId: sheet.id, expectedVersion: saved.version, headerRow: header, firstRow: first, lastRow: last, confirmed: true, mapping: columnMapping }) });
      setServerResult(response.result); setPage(1);
    } catch (cause) {
      const message = cause instanceof ApiError && cause.status === 409 ? "La hoja cambió en otra sesión. Guarda o recarga la hoja y prepara una nueva vista previa." : cause instanceof Error ? cause.message : "No se pudo interpretar la hoja en el servidor.";
      setError(message);
    } finally { setServerBusy(false); }
  }
  async function applyServerPreview() {
    const saved = getSavedReference(); if (!serverResult || serverResult.rows.some(row => row.classification === "ERROR" || row.classification === "EMPTY") || saved.dirty || saved.version === null || !sheet) return;
    setApplyBusy(true); setError("");
    try {
      const keys = applyKeys.current ?? { batchId: crypto.randomUUID(), operationId: crypto.randomUUID() }; applyKeys.current = keys;
      const mappingBody = Object.fromEntries(mapping.map((field, column) => [String(column), field]));
      await apiRequest("/inventory/workbook/preview/apply", { method: "POST", body: JSON.stringify({ ...keys, workbookId: saved.workbookId, sheetId: sheet.id, expectedVersion: saved.version, headerRow: header, firstRow: first, lastRow: last, confirmed: true, mapping: mappingBody, reason: "Aplicación confirmada desde hoja libre" }) });
      setServerResult(null); applyKeys.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo aplicar el lote. No se modificó parcialmente."); }
    finally { setApplyBusy(false); }
  }
  async function capture() {
    if (capturing.current) return; capturing.current = true; setBusy(true); setError("");
    try { const parsed = readWorkbookSnapshot(await getSnapshot()); setBook(parsed); const selected = parsed.sheets.find(value => value.id === getActiveSheetId()) ?? parsed.sheets[0]; if (selected) choose(selected); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo leer la hoja."); }
    finally { capturing.current = false; setBusy(false); }
  }
  return <section aria-label="Lectura de datos de la hoja" className="space-y-4 rounded-xl border border-[#dce4dc] bg-white p-4">
    <h2 className="text-xl font-semibold">Leer los datos de mi hoja</h2>
    <p className="text-sm">Elige qué significan tus columnas y revisa el resultado. Esta primera lectura no guarda productos ni ajusta existencias.</p>
    <button className="min-h-11 rounded border px-4 disabled:opacity-50" disabled={!ready || busy} onClick={() => void capture()}>{busy ? "Leyendo…" : "Preparar lectura"}</button>
    {error && <p role="alert" className="text-red-900">{error}</p>}
    {book && sheet && <>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
      <p className="text-sm">Se está leyendo una captura de tus datos al pulsar el botón. Si editas la hoja, vuelve a Preparar lectura. Se incluyen las filas ocultas del rango.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <label>Pestaña<select aria-label="Pestaña para leer" className="block min-h-11 w-full rounded border px-2" value={sheetId} onChange={event => { const selected = book.sheets.find(value => value.id === event.target.value); if (selected) choose(selected); }}>{book.sheets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <label>Fila de títulos<input aria-label="Fila de títulos" className="block min-h-11 w-full rounded border px-2" type="number" min={1} max={sheet.rowCount} value={header} onChange={event => { setHeader(Number(event.target.value)); setMapping(Array.from({ length: sheet.columnCount }, () => "ignore")); setResult(null); }} /></label>
        <label>Primera fila de datos<input aria-label="Primera fila de datos" className="block min-h-11 w-full rounded border px-2" type="number" min={header + 1} max={sheet.rowCount} value={first} onChange={event => { setFirst(Number(event.target.value)); setResult(null); }} /></label>
        <label>Última fila de datos<input aria-label="Última fila de datos" className="block min-h-11 w-full rounded border px-2" type="number" min={first} max={sheet.rowCount} value={last} onChange={event => { setLast(Number(event.target.value)); setResult(null); }} /></label>
      </div>
      <p className="text-sm">Las coincidencias de títulos son sugerencias. “Cantidad”, “stock” o “valor” requieren tu elección: no se adivina si son saldo, movimiento, precio o costo.</p>
      <button className="min-h-11 rounded border px-4" onClick={() => { setMapping(suggestReadingFields(sheet, header)); setResult(null); }}>Sugerir asignación por títulos</button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{used.map(column => <label key={column} className="rounded border p-3"><span className="font-semibold">{columnName(column)} · {String(sheet.cells[header - 1]?.[column]?.value ?? "Sin título")}</span><select aria-label={`Interpretar columna ${columnName(column)}`} className="mt-2 block min-h-11 w-full rounded border px-2" value={mapping[column] ?? "ignore"} onChange={event => {
        const field = readingFields.find(value => value === event.target.value); if (!field) return;
        setMapping(current => Array.from({ length: sheet.columnCount }, (_, index) => index === column ? field : current[index] ?? "ignore")); setResult(null);
      }}>{readingFields.map(field => <option key={field} value={field}>{labels[field]}</option>)}</select></label>)}</div>
      {!used.length && <p>Esta pestaña no tiene celdas con datos.</p>}
      <button className="min-h-11 rounded bg-[#173d2a] px-4 font-semibold text-white" onClick={() => {
        setError(""); setResult(null); setPage(1);
        try { setResult(previewWorkbookReading(sheet, header, first, last, mapping)); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa la asignación."); }
      }}>Generar vista previa de lectura</button>
      <button className="min-h-11 rounded border border-[#173d2a] px-4 font-semibold disabled:opacity-50" disabled={serverBusy || !mapping.some(field => field === "sku")} onClick={() => void serverPreview()}>{serverBusy ? "Consultando servidor…" : "Vista previa autoritativa"}</button>
      {serverResult && <section className="space-y-3 rounded border border-[#dce4dc] bg-[#f7faf7] p-3" aria-label="Vista previa autoritativa del servidor"><p role="status">Servidor: {serverResult.rows.length} filas · {serverResult.rows.filter(row => row.classification === "ERROR").length} con error · Aplicación disponible solo tras confirmación explícita.</p><div className="max-h-[55vh] overflow-auto rounded border"><table className="w-full text-sm"><thead><tr><th className="p-2">Fila</th><th className="p-2">Clasificación</th><th className="p-2">Errores</th></tr></thead><tbody>{serverResult.rows.slice((page - 1) * 50, page * 50).map(row => <tr className="border-t" key={row.rowNumber}><th className="p-2" scope="row">{row.rowNumber}</th><td className="p-2">{row.classification}</td><td className="p-2">{row.errors.length ? row.errors.map(issue => `${issue.field}: ${issue.message}`).join(" · ") : "Sin errores"}</td></tr>)}</tbody></table></div><button className="min-h-11 rounded bg-[#173d2a] px-4 font-semibold text-white disabled:opacity-50" disabled={applyBusy || serverResult.canApply || serverResult.rows.some(row => row.classification === "ERROR" || row.classification === "EMPTY")} onClick={() => void applyServerPreview()}>{applyBusy ? "Aplicando lote…" : "Confirmar y aplicar lote"}</button><p className="text-xs">La aplicación es atómica, usa el motor de lotes y no crea catálogo ni ventas.</p></section>}
      {serverResult && <div className="overflow-auto rounded border" aria-label="Saldos por fila"><table className="w-full text-sm"><thead><tr><th className="p-2">Fila</th><th className="p-2">Clasificación</th><th className="p-2">Stock actual</th><th className="p-2">Stock final contado</th><th className="p-2">Ajuste</th></tr></thead><tbody>{serverResult.rows.map(row => <tr className="border-t" key={`stock-${row.rowNumber}`}><th className="p-2" scope="row">{row.rowNumber}</th><td className="p-2">{row.classification}</td><td className="p-2">{row.stockCurrent ?? "—"}</td><td className="p-2">{row.stockTarget ?? "—"}</td><td className="p-2">{row.delta > 0 ? `+${row.delta}` : row.delta ?? "—"}</td></tr>)}</tbody></table></div>}
      {result && <>
        <p role="status">{result.rows.length} filas leídas · {result.errorRows} filas con errores · {result.emptyRows} filas vacías omitidas. No se modificó el inventario.</p>
        <div className="max-h-[55vh] overflow-auto rounded border" role="region" aria-label="Vista previa de lectura" tabIndex={0}><table className="w-full text-sm"><thead><tr><th className="p-2">Fila original</th>{readingFields.filter(field => field !== "ignore" && mapping.includes(field)).map(field => <th className="p-2" key={field}>{labels[field]}</th>)}<th className="p-2">Observaciones</th></tr></thead><tbody>{result.rows.slice((page - 1) * 50, page * 50).map(row => <tr key={row.rowNumber} className="border-t"><th className="p-2" scope="row">{row.rowNumber}</th>{readingFields.filter(field => field !== "ignore" && mapping.includes(field)).map(field => <td className="p-2" key={field}>{field !== "ignore" ? row.values[field] ?? "—" : ""}</td>)}<td className="min-w-64 p-2">{row.errors.map((issue, index) => <p className="text-red-900" key={index}>{issue}</p>)}{row.formulas.length > 0 && <p>Resultados de fórmula en {row.formulas.join(", ")}.</p>}{!row.errors.length && "Lectura sin errores de formato."}</td></tr>)}</tbody></table></div>
        <nav aria-label="Páginas de lectura" className="flex items-center gap-3"><button className="min-h-11 rounded border px-3 disabled:opacity-50" disabled={page === 1} onClick={() => setPage(page - 1)}>Lectura anterior</button><span>Página {page} de {Math.max(1, Math.ceil(result.rows.length / 50))}</span><button className="min-h-11 rounded border px-3 disabled:opacity-50" disabled={page * 50 >= result.rows.length} onClick={() => setPage(page + 1)}>Lectura siguiente</button></nav>
      </>}
      </fieldset>
    </>}
  </section>;
}
