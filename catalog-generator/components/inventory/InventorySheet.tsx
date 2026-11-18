"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { columns, mapRows, parseDelimited, suggestedMapping, type Matrix, type Values, type Field } from "@/lib/inventory-sheet/formats";

type Report = { action: string; delta: number; errors: { field: string; message: string }[]; before: { stock: number } | null; after: { stock: number } | null };
type Row = { rowId: string; rowNumber: number; revision?: number; excluded: boolean; values: Values; report?: Report | null };
type Batch = { id: string; source: string; status: string; revision: number; previewRevision: number; totalRows: number; planHash: string | null; applyOperationId: string | null; receipt: { rowCount: number; movementCount: number } | null; counts: Record<string, number> };
type Item = { id: string; sku: string; name: string; stock: number; minimumStock: number; dataVersion: number; stockVersion: number; commercialTerms: { unitSalePrice: string; referenceUnitCost: string | null; version: number } | null };
const allEditable = columns.filter(([, field]) => !["profile", "id", "currentStock", "dataVersion", "stockVersion", "termsVersion"].includes(field));
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });
async function api<T>(path: string, options?: RequestInit) { return (await apiRequest<{ result: T }>(`/inventory${path}`, options)).result; }
const newRow = (values: Values, index: number): Row => ({ rowId: crypto.randomUUID(), rowNumber: index + 2, excluded: Object.values(values).length > 0 && Object.values(values).every(value => value === null || String(value).trim() === ""), values });

export default function InventorySheet() {
  const [rows, setRows] = useState<Row[]>([]), [batch, setBatch] = useState<Batch | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [page, setPage] = useState(1), [browsePage, setBrowsePage] = useState(1), [query, setQuery] = useState("");
  const [matrix, setMatrix] = useState<Matrix | null>(null), [mapping, setMapping] = useState<string[]>([]), [delimiter, setDelimiter] = useState(",");
  const [source, setSource] = useState("GRID"), [reason, setReason] = useState(""), [paste, setPaste] = useState("");
  const [exportCursor, setExportCursor] = useState(""), [filter, setFilter] = useState("all"), [restore, setRestore] = useState("");
  const [reading, setReading] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]), [expandedRow, setExpandedRow] = useState("");
  const [selection, setSelection] = useState<{ row: string; field: Field; endRow: string; endField: Field } | null>(null), [copied, setCopied] = useState("");
  const editable = allEditable.filter(([, field]) => !hiddenColumns.includes(field));
  const [recent, setRecent] = useState<Batch[]>([]), [recentPage, setRecentPage] = useState(1), [recentTotal, setRecentTotal] = useState(0);
  const pending = useRef(false), worker = useRef<Worker | null>(null), readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staged = useRef<{ chunkId: string; expectedRevision: number; totalRows: number; rows: Row[] } | null>(null);
  const creating = useRef<{ id: string; source: string; totalRows: number; reason: string } | null>(null);
  const downloading = useRef(false);
  const terminal = batch?.status === "APPLIED" || batch?.status === "CANCELLED";
  async function work(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar. Recupera el mismo lote antes de reintentar."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function load(id: string) {
    const result = await api<Batch>(`/batches/${id}`); let loaded: Row[] = [];
    for (let number = 1; loaded.length < result.totalRows; number++) {
      const part = await api<{ rows: Row[] }>(`/batches/${id}/rows?page=${number}`);
      if (!part.rows.length) break; loaded = loaded.concat(part.rows);
    }
    setBatch(result); setRows(loaded); setDirty(false); setPage(1); setSource(result.source);
    window.history.replaceState(null, "", `?batchId=${encodeURIComponent(id)}`);
    setRestore(id); setMessage(result.status === "APPLIED" ? "Lote aplicado. El recibo persistido confirma el resultado." : "Borrador recuperado del servidor.");
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("batchId");
    const timer = setTimeout(() => { if (id && /^[a-f0-9-]{36}$/i.test(id)) void work(() => load(id)); }, 0);
    return () => { clearTimeout(timer); worker.current?.terminate(); if (readTimer.current) clearTimeout(readTimer.current); };
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(rowId: string, field: Field, value: string) {
    if (staged.current) { setError("Primero recupera o reintenta la carga pendiente antes de cambiar sus datos."); return; }
    setRows(current => current.map(row => row.rowId === rowId ? { ...row, values: { ...row.values, [field]: value }, report: null } : row)); setDirty(true);
  }
  async function preview() {
    if (!rows.length) throw new Error("Agrega al menos una fila.");
    let current = batch;
    if (!current) {
      const input = creating.current ?? { id: crypto.randomUUID(), source, totalRows: rows.length, reason };
      creating.current = input;
      window.history.replaceState(null, "", `?batchId=${input.id}`); setRestore(input.id);
      current = await api<Batch>("/batches", json("POST", input)); setBatch(current); creating.current = null;
    }
    if (dirty || current.totalRows !== rows.length || current.status === "DRAFT") {
      let working = [...rows], revision = current.revision;
      for (let offset = 0; offset < working.length; offset += 50) {
        const input = staged.current ?? { chunkId: crypto.randomUUID(), expectedRevision: revision, totalRows: working.length, rows: working.slice(offset, offset + 50).map(row => {
          const values = { ...row.values }; delete values.currentStock; delete values.profile;
          return { rowId: row.rowId, rowNumber: row.rowNumber, revision: row.revision, excluded: row.excluded, values };
        }) };
        staged.current = input;
        const result = await api<{ revision: number; rows: { rowId: string; revision: number }[] }>(`/batches/${current.id}/rows`, json("PATCH", input));
        revision = result.revision;
        working = working.map(row => ({ ...row, revision: result.rows.find(value => value.rowId === row.rowId)?.revision ?? row.revision }));
        setRows(working); setBatch({ ...current, revision }); staged.current = null;
      }
      current = { ...current, revision }; setDirty(false);
    }
    setBatch(await api<Batch>(`/batches/${current.id}/preview`, json("POST", { expectedRevision: current.revision })));
    await load(current.id); setMessage("Vista previa calculada por el servidor. Revisa los ajustes antes de confirmar.");
  }
  function stopRead() { worker.current?.terminate(); worker.current = null; if (readTimer.current) clearTimeout(readTimer.current); setBusy(false); setReading(false); pending.current = false; }
  function read(file: File) {
    if (pending.current || dirty || rows.length) { setError("Usa un borrador vacío antes de importar otro archivo."); return; }
    pending.current = true; setBusy(true); setReading(true); setError("");
    const reader = new Worker(new URL("../../lib/inventory-sheet/reader.worker.ts", import.meta.url)); worker.current = reader;
    reader.onmessage = (event: MessageEvent<{ ok: boolean; message?: string; matrix?: Matrix; hidden?: boolean }>) => {
      stopRead(); if (!event.data.ok || !event.data.matrix) { setError(event.data.message ?? "Archivo inválido."); return; }
      setMatrix(event.data.matrix); setMapping(suggestedMapping(event.data.matrix)); setSource(/\.xlsx$/i.test(file.name) ? "XLSX" : "CSV");
      setMessage(event.data.hidden ? "Hay filas ocultas o filtros: se revisarán todas las filas, incluidas las ocultas." : "Revisa la asignación de columnas antes de cargar el borrador.");
    };
    reader.onerror = () => { stopRead(); setError("No se pudo leer el archivo."); };
    readTimer.current = setTimeout(() => { stopRead(); setError("La lectura superó 10 segundos. Simplifica el archivo."); }, 10000);
    reader.postMessage({ file, delimiter });
  }
  async function download(format: string, template = false) {
    if (downloading.current) return; downloading.current = true;
    try {
      const params = new URLSearchParams({ format, template: String(template), limit: "500", segment: "true", q: query });
      if (exportCursor && !template) params.set("cursor", exportCursor);
      const response = await fetch(`/api/backend/inventory/export?${params}`, { cache: "no-store" });
      if (!response.ok) { const body: unknown = await response.json(); throw new Error(typeof body === "object" && body && "message" in body ? String(body.message) : "No se pudo exportar."); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a"); link.href = url; link.download = `inventario.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (!template) setExportCursor(response.headers.get("X-Inventory-Next-Cursor") ?? "");
      setMessage(`Exportación descargada (${response.headers.get("X-Inventory-Row-Count") ?? "0"} filas). La existencia objetivo está vacía.`);
    } finally { downloading.current = false; }
  }
  const visible = rows.filter(row => filter === "all" || (filter === "ADJUSTMENT" ? Boolean(row.report?.delta) : row.report?.action === filter));
  const expanded = rows.find(row => row.rowId === expandedRow);
  const bounds = selection ? { a: visible.findIndex(row => row.rowId === selection.row), b: visible.findIndex(row => row.rowId === selection.endRow), c: editable.findIndex(([, field]) => field === selection.field), d: editable.findIndex(([, field]) => field === selection.endField) } : null;
  function marked(rowId: string, field: Field) { if (!bounds) return false; const row = visible.findIndex(value => value.rowId === rowId), column = editable.findIndex(([, value]) => value === field); return row >= Math.min(bounds.a, bounds.b) && row <= Math.max(bounds.a, bounds.b) && column >= Math.min(bounds.c, bounds.d) && column <= Math.max(bounds.c, bounds.d); }
  return <main className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-8">
    <Link className="inline-flex min-h-11 items-center underline" href="/dashboard/inventario">← Inventario tradicional</Link>
    <h1 className="text-3xl font-semibold">Hoja de inventario</h1>
    <p>Edita hasta 500 filas. Los datos, precios y existencias se validan por separado. Nada cambia hasta confirmar la vista previa.</p>
    <p role="status" aria-live="polite">{message}</p>{error && <p role="alert" className="rounded border border-red-400 p-3 text-red-900">{error} <Link className="underline" href="/login">Iniciar sesión</Link></p>}
    <div className="flex flex-wrap gap-3">
      <label>Recuperar lote por ID<input aria-label="ID del lote" value={restore} onChange={e => setRestore(e.target.value)} className="block border p-2" /></label>
      <button disabled={busy || dirty} onClick={() => void work(() => load(restore))}>Recuperar lote</button>
      <button disabled={busy || dirty} onClick={() => void work(async () => { const result = await api<{ batches: Batch[]; total: number }>(`/batches?page=${recentPage}`); setRecent(result.batches); setRecentTotal(result.total); })}>Consultar mis lotes</button>
      <button disabled={busy || dirty} onClick={() => { setBatch(null); setRows([]); setMatrix(null); setRestore(""); setExportCursor(""); setPage(1); staged.current = null; creating.current = null; window.history.replaceState(null, "", window.location.pathname); }}>Nuevo borrador</button>
    </div>
    {recent.length > 0 && <section aria-label="Mis lotes" className="space-y-2"><ul>{recent.map(value => <li key={value.id}><button disabled={busy || dirty} onClick={() => void work(() => load(value.id))}>{value.id} · {value.status} · {value.totalRows} filas</button></li>)}</ul><label>Página de lotes<input type="number" min={1} max={Math.max(1, Math.ceil(recentTotal / 20))} value={recentPage} onChange={e => setRecentPage(Number(e.target.value))} className="ml-2 w-24 border p-2" /></label><p>{recentTotal} lotes. Cambia la página y pulsa Consultar mis lotes.</p></section>}
    <fieldset disabled={busy || terminal} className="min-w-0 space-y-4 rounded border p-4">
      <legend>Cargar o editar borrador</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label>Búsqueda literal<input value={query} onChange={e => { setQuery(e.target.value); setBrowsePage(1); setExportCursor(""); }} className="block border p-2" /></label>
        <label>Página del inventario<input type="number" min="1" value={browsePage} onChange={e => setBrowsePage(Number(e.target.value))} className="block w-24 border p-2" /></label>
        <button disabled={Boolean(batch) || rows.length > 476} onClick={() => void work(async () => {
          const result = await api<{ items: Item[] }>(`/items?page=${browsePage}&q=${encodeURIComponent(query)}`);
          const incoming = result.items.filter(item => !rows.some(row => row.values.id === item.id)).map((item, index) => newRow({ id: item.id, name: item.name, sku: item.sku, currentStock: item.stock, minimumStock: item.minimumStock, dataVersion: item.dataVersion, stockVersion: item.stockVersion, termsVersion: item.commercialTerms?.version ?? "", unitSalePrice: item.commercialTerms?.unitSalePrice ?? "", referenceUnitCost: item.commercialTerms?.referenceUnitCost ?? "", targetStock: "" }, rows.length + index));
          setRows([...rows, ...incoming]); setDirty(true); setBrowsePage(browsePage + 1); setMessage(`${incoming.length} filas agregadas al borrador; cada página carga hasta 24 artículos.`);
        })}>Cargar página (24)</button>
        <button disabled={rows.length >= 500 || Boolean(batch)} onClick={() => { setRows([...rows, newRow({}, rows.length)]); setDirty(true); }}>Agregar fila</button>
      </div>
      <label>Motivo general de ajustes (se fija al crear el lote)<input disabled={Boolean(batch)} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className="block w-full border p-2" /></label>
      <div className="flex flex-wrap gap-4"><label className="max-w-full">Archivo XLSX / CSV<input type="file" accept=".xlsx,.csv" disabled={Boolean(batch) || rows.length > 0} onChange={e => { const file = e.target.files?.[0]; if (file) read(file); e.target.value = ""; }} className="block w-full max-w-full" /></label>
        <label>Separador CSV<select value={delimiter} onChange={e => setDelimiter(e.target.value)} className="block border p-2"><option value=",">Coma</option><option value=";">Punto y coma</option></select></label></div>
      <label className="block">Pegar tabla con cabeceras (Excel / Sheets)<textarea disabled={Boolean(batch) || rows.length > 0} value={paste} onChange={e => setPaste(e.target.value)} className="block min-h-24 w-full border p-2" /></label>
      <button disabled={Boolean(batch) || rows.length > 0} onClick={() => void work(async () => { const parsed = parseDelimited(paste, "\t"); setMatrix(parsed); setMapping(suggestedMapping(parsed)); setSource("PASTE"); })}>Revisar columnas pegadas</button>
      {matrix && <section aria-label="Asignación de columnas" className="space-y-3"><p>{matrix.length - 1} filas. Todas se incluirán, incluso las vacías. Asigna las columnas; ninguna columna desconocida se descarta sin tu revisión.</p>
        <div className="grid gap-3 sm:grid-cols-3">{matrix[0]?.map((header, index) => <label key={index}>{String(header ?? `Columna ${index + 1}`)}<select aria-label={`Asignar columna ${index + 1}`} value={mapping[index] ?? ""} onChange={e => setMapping(mapping.map((value, i) => i === index ? e.target.value : value))} className="block w-full border p-2"><option value="">Ignorar explícitamente</option>{columns.map(([name, field]) => <option key={field} value={field}>{name}</option>)}</select></label>)}</div>
        <button onClick={() => void work(async () => { const values = mapRows(matrix, mapping); setRows(values.map(newRow)); setDirty(true); setMatrix(null); setPaste(""); })}>Confirmar asignación y cargar filas</button>
      </section>}
    </fieldset>
    {reading && <button onClick={() => { stopRead(); setMessage("Lectura cancelada; no se modificó el inventario."); }}>Cancelar lectura</button>}
    <div className="flex flex-wrap items-center gap-3"><label>Mostrar<select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} className="ml-2 border p-2">{["all", "NEW", "MODIFIED", "UNCHANGED", "ERROR", "EXCLUDED", "ADJUSTMENT"].map(value => <option key={value} value={value}>{value}</option>)}</select></label><span>{rows.length}/500 filas · {dirty ? "Cambios pendientes de vista previa" : batch?.status ?? "Borrador local"}</span></div>
    <details><summary className="min-h-11 cursor-pointer">Columnas visibles</summary><div className="flex flex-wrap gap-4">{allEditable.filter(([, field]) => field !== "sku").map(([name, field]) => <label key={field}><input type="checkbox" checked={!hiddenColumns.includes(field)} onChange={e => { setHiddenColumns(e.target.checked ? hiddenColumns.filter(value => value !== field) : [...hiddenColumns, field]); setSelection(null); }} /> {name}</label>)}</div></details>
    <p className="text-sm">Selecciona una celda y usa Mayús + clic en otra para marcar un rectángulo; con teclado, Alt + Mayús + flechas. El pegado respeta las filas filtradas y las columnas visibles. Las filas vacías de un archivo se excluyen explícitamente.</p>
    <button disabled={!selection} onClick={() => { if (!selection) return; const a = visible.findIndex(row => row.rowId === selection.row), b = visible.findIndex(row => row.rowId === selection.endRow), c = editable.findIndex(([, field]) => field === selection.field), d = editable.findIndex(([, field]) => field === selection.endField);
      const quote = (value: string) => /[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
      const value = visible.slice(Math.min(a, b), Math.max(a, b) + 1).map(row => editable.slice(Math.min(c, d), Math.max(c, d) + 1).map(([, field]) => quote(String(row.values[field] ?? ""))).join("\t")).join("\n"); setCopied(value); void navigator.clipboard?.writeText(value).catch(() => setMessage("Selecciona el texto del área de copia para copiarlo manualmente.")); }}>Copiar selección rectangular</button>
    {copied && <label className="block">Selección para copiar<textarea readOnly value={copied} onFocus={e => e.target.select()} className="block w-full border p-2" /></label>}
    {expanded && <section className="space-y-3 rounded border p-4" aria-label={`Edición ampliada fila ${expanded.rowNumber}`}><h2 className="font-semibold">Editar fila {expanded.rowNumber} · {String(expanded.values.sku ?? "Nueva")}</h2><p>ID: {String(expanded.values.id ?? "Se asignará al crear")} · Existencia actual: {expanded.report?.before?.stock ?? expanded.values.currentStock ?? 0}</p><div className="grid gap-3 sm:grid-cols-3">{allEditable.map(([name, field]) => <label key={field}>{name}<input aria-label={`${name} ampliada`} disabled={busy || terminal} value={String(expanded.values[field] ?? "")} onChange={e => change(expanded.rowId, field, e.target.value)} className="block min-h-11 w-full border p-2" /></label>)}</div>{expanded.report?.errors.map((issue, index) => <p key={index} className="text-red-900">{issue.field}: {issue.message}</p>)}<button onClick={() => setExpandedRow("")}>Cerrar edición ampliada</button></section>}
    <div className="max-h-[65vh] overflow-auto rounded border" tabIndex={0} role="region" aria-label="Tabla editable de inventario">
      <table className="w-full border-collapse text-sm"><thead className="sticky top-0 z-10 bg-white"><tr><th className="p-2">Fila / incluir</th>{editable.map(([name, field]) => <th key={field} scope="col" className={`p-2 ${field === "sku" ? "sticky left-0 bg-white" : ""}`}>{name}</th>)}<th scope="col">Existencia actual</th><th scope="col">Vista previa / errores</th></tr></thead>
        <tbody>{visible.slice((page - 1) * 50, page * 50).map(row => <tr key={row.rowId} className="border-t"><th scope="row" className="p-2">{row.rowNumber}<input type="checkbox" aria-label={`Incluir fila ${row.rowNumber}`} checked={!row.excluded} disabled={busy || terminal} onChange={e => { if (staged.current) { setError("Recupera o reintenta la carga pendiente antes de excluir filas."); return; } setRows(rows.map(value => value.rowId === row.rowId ? { ...value, excluded: !e.target.checked } : value)); setDirty(true); }} /><button onClick={() => setExpandedRow(row.rowId)}>Editar fila {row.rowNumber}</button></th>
          {editable.map(([name, field]) => <td key={field} className={`p-1 ${marked(row.rowId, field) ? "bg-blue-100" : "bg-white"} ${field === "sku" ? "sticky left-0" : ""}`}><input aria-label={`${name} fila ${row.rowNumber}`} className="min-h-11 w-36 rounded border p-2 focus:outline-2 focus:outline-green-800" disabled={busy || terminal} value={String(row.values[field] ?? "")} onKeyDown={e => {
            if (!e.altKey || !e.shiftKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return; e.preventDefault();
            const start = selection ?? { row: row.rowId, field, endRow: row.rowId, endField: field };
            const r = visible.findIndex(value => value.rowId === start.endRow) + (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0), c = editable.findIndex(([, value]) => value === start.endField) + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
            if (visible[r] && editable[c]) setSelection({ ...start, endRow: visible[r].rowId, endField: editable[c][1] });
          }} onPointerDown={e => setSelection(e.shiftKey && selection ? { ...selection, endRow: row.rowId, endField: field } : { row: row.rowId, field, endRow: row.rowId, endField: field })} onChange={e => change(row.rowId, field, e.target.value)} onPaste={e => {
            if (staged.current) { e.preventDefault(); setError("Recupera o reintenta la carga pendiente antes de pegar."); return; }
            const text = e.clipboardData.getData("text"); if (!text.includes("\t") && !text.includes("\n")) return; e.preventDefault();
            try { const cells = parseDelimited(text, "\t"), start = editable.findIndex(([, key]) => key === field), offset = visible.findIndex(value => value.rowId === row.rowId);
              if (offset + cells.length > visible.length || cells.some(line => start + line.length > editable.length)) throw new Error("El pegado excede las filas o columnas editables. Agrega filas primero o usa la importación con cabeceras.");
              const targets = new Map(cells.map((line, index) => [visible[offset + index].rowId, line]));
              setRows(rows.map(value => { const line = targets.get(value.rowId); if (!line) return value; const values = { ...value.values }; line.forEach((cell, column) => { values[editable[start + column][1]] = cell; }); return { ...value, values, report: null }; })); setDirty(true);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Pegado inválido."); }
          }} /></td>)}<td className="p-2">{row.report?.before?.stock ?? row.values.currentStock ?? 0}</td><td className="min-w-64 p-2">{row.report && <><span>{row.report.action} · delta {row.report.delta} · saldo final {row.report.after?.stock ?? "—"}</span>{row.report.errors.map((issue, index) => <p key={index} className="text-red-900">{issue.field}: {issue.message}</p>)}</>}</td></tr>)}</tbody></table>
    </div>
    <nav aria-label="Páginas del borrador" className="flex items-center gap-4"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(visible.length / 50))}</span><button disabled={page * 50 >= visible.length} onClick={() => setPage(page + 1)}>Siguiente</button></nav>
    <div className="flex flex-wrap gap-4"><button disabled={busy || terminal || !rows.length} onClick={() => void work(preview)}>Guardar y previsualizar</button>
      <button disabled={busy || dirty || batch?.status !== "READY"} onClick={() => void work(async () => { if (!batch) return; await api(`/batches/${batch.id}/apply`, json("POST", { expectedRevision: batch.revision, previewRevision: batch.previewRevision, planHash: batch.planHash, operationId: batch.applyOperationId })); await load(batch.id); })}>Confirmar lote completo</button>
      <button disabled={busy || !batch || terminal} onClick={() => void work(async () => { if (batch) { setBatch(await api<Batch>(`/batches/${batch.id}/cancel`, json("POST", {}))); setDirty(false); } })}>Cancelar lote sin aplicar</button>
      {batch && <a className="underline" href={`/api/backend/inventory/batches/${batch.id}/report`}>Descargar informe por fila CSV</a>}
    </div>
    {batch && <section aria-label="Resumen del lote" className="break-words"><p>ID: {batch.id} · Estado: {batch.status}</p><p>{Object.entries(batch.counts).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>{batch.receipt && <p role="status">Recibo persistido: {batch.receipt.rowCount} filas, {batch.receipt.movementCount} movimientos. Puedes recargar esta dirección sin repetir la aplicación.</p>}</section>}
    <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Exportación y plantillas</h2><p>Segmentos explícitos de hasta 500 filas. La descarga respeta la búsqueda y no reemplaza el inventario. Conserva SKU y dinero como texto al usar CSV.</p><div className="flex flex-wrap gap-4">{["csv", "xlsx"].map(format => <span key={format} className="flex gap-3"><button disabled={busy} onClick={() => void work(() => download(format, true))}>Plantilla {format.toUpperCase()}</button><button disabled={busy} onClick={() => void work(() => download(format))}>{exportCursor ? "Siguiente segmento" : "Exportar"} {format.toUpperCase()}</button></span>)}<button onClick={() => setExportCursor("")}>Reiniciar exportación</button></div></section>
    <style jsx>{`button { min-height:44px; border:1px solid #536d5b; border-radius:6px; padding:8px 12px; } button:disabled { opacity:.45; } button:focus-visible,select:focus-visible { outline:2px solid #166534; outline-offset:2px; }`}</style>
  </main>;
}
