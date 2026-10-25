"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { importTextHelp, importBusy, importCounts, importFieldLabel, type ImportFlowState, type ProductImportFlow, type RowStatus } from "@/lib/product-import-flow";

const button = "min-h-11 rounded-lg border border-[#bccdbf] px-4 py-2 text-sm font-semibold text-[#245c4c] transition hover:bg-[#edf4ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245c4c] disabled:cursor-not-allowed disabled:opacity-50";
const statusLabels: Record<RowStatus, string> = { waiting: "Sin clasificar", new: "Nueva", update: "Actualizar", created: "Creada", updated: "Actualizada", error: "Con error", not_processed: "No procesada", unknown: "Resultado desconocido" };
const phaseLabels = { idle: "Selecciona un archivo", reading: "Leyendo archivo…", previewing: "Generando vista previa", ready: "Lista para revisar", writing: "Importando productos", stopped: "Operación detenida", completed: "Reporte final", error: "La operación necesita atención" };

export default function ProductImportPanel({ flow, state, archived, onClose }: {
  flow: ProductImportFlow; state: ImportFlowState; archived: boolean; onClose: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null), summary = useRef<HTMLHeadingElement>(null), tableTitle = useRef<HTMLTableCaptionElement>(null);
  const previousPhase = useRef(state.phase);
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const busy = importBusy(state.phase), counts = importCounts(state.report);
  const eligible = counts.new + counts.updates;
  const pages = Math.max(1, Math.ceil(state.report.length / 25)), currentPage = Math.min(page, pages - 1);
  const retrySeconds = Math.max(0, Math.ceil(((state.failure?.retryAt ?? 0) - now) / 1000));
  const fileDisabledReason = archived ? "Este catálogo está archivado y no admite importaciones."
    : busy ? "Espera a que termine la operación o usa la acción de cancelar o detener."
    : state.failure?.status === 401 ? "Vuelve a iniciar sesión para seleccionar un archivo."
    : retrySeconds > 0 ? `Podrás seleccionar otro archivo en ${retrySeconds} s.` : "";
  const expired = state.expiresAt > 0 && now >= state.expiresAt;
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    const changed = previousPhase.current !== state.phase;
    previousPhase.current = state.phase;
    if (changed && (["ready", "stopped", "completed", "error"].includes(state.phase) || Boolean(state.formatWarning))) summary.current?.focus();
  }, [state.phase, state.formatWarning]);
  useEffect(() => {
    if (!state.expiresAt && !state.failure?.retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.expiresAt, state.failure?.retryAt]);

  const changePage = (next: number) => { setPage(next); requestAnimationFrame(() => tableTitle.current?.focus()); };
  return <section aria-labelledby="product-import-title" className="mt-8 rounded-2xl border border-[#cbd7cc] bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 ref={title} id="product-import-title" tabIndex={-1} className="text-xl font-semibold text-[#202b27] focus-visible:outline-2">Importar productos desde Excel</h2><p className="mt-1 text-sm text-[#52655a]">Crea o actualiza productos. No borra productos ni cambia su visibilidad; añade las imágenes después.</p></div>
      <button type="button" className={button} onClick={onClose} disabled={busy} aria-describedby={busy ? "import-close-help" : undefined}>Cerrar importación</button>
    </div>
    {busy && <p id="import-close-help" className="mt-2 text-sm text-[#52655a]">El cierre está bloqueado mientras hay trabajo activo. Usa la acción de cancelar o detener que aparece abajo.</p>}
    {archived && <p role="alert" className="mt-4 text-sm text-[#963b23]">Este catálogo está archivado y no admite importaciones.</p>}
    <p className="mt-5 text-sm text-[#52655a]">¿Primera vez? <a href="/templates/productos.xlsx" download="plantilla-productos.xlsx" className="font-semibold text-[#245c4c] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245c4c]">Descargar plantilla</a> con las columnas correctas.</p>
    <div className="mt-4 flex min-w-0 items-center gap-3">
      <div className="relative shrink-0">
        <input id="product-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-describedby={`product-import-file-name product-import-rules${fileDisabledReason ? " product-import-file-help" : ""}`} disabled={Boolean(fileDisabledReason)} className="peer sr-only" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setPage(0); void flow.select(file); } }} />
        <label htmlFor="product-import-file" aria-disabled={Boolean(fileDisabledReason)} className={`${button} inline-flex cursor-pointer items-center peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#245c4c] peer-disabled:cursor-not-allowed peer-disabled:opacity-50`}>Seleccionar archivo<span className="sr-only"> Excel</span></label>
      </div>
      <span id="product-import-file-name" aria-live="polite" aria-atomic="true" className="flex min-h-11 min-w-0 flex-1 items-center break-all text-sm text-[#52655a]">{state.fileName || "Ningún archivo seleccionado"}</span>
    </div>
    {fileDisabledReason && <p id="product-import-file-help" className="mt-2 text-sm text-[#52655a]">{fileDisabledReason}</p>}
    <p id="product-import-rules" className="mt-3 text-sm leading-6 text-[#52655a]">Solo .xlsx, hasta 5 MiB y 500 filas. Guarda SKU como Texto antes de escribir (por ejemplo, 00123). Las celdas vacías conservan los valores existentes. El archivo se lee en tu navegador; solo se envían filas JSON para validar e importar.</p>
    <div role="status" aria-live="polite" aria-atomic="true" className={state.phase === "idle" && !state.notice ? "sr-only" : "mt-2 text-sm text-[#245c4c]"}>
      <p className="font-semibold">{phaseLabels[state.phase]}</p><p className="mt-1">{state.notice}</p>
      {(state.phase === "previewing" || state.phase === "writing") && <p className="mt-2">Lote {state.progress.batch} de {state.progress.batches}. Respuesta recibida para {state.progress.received} de {state.progress.total} filas.</p>}
      {state.phase === "reading" && <p className="mt-2">Tiempo máximo de lectura: 10 segundos. No hay progreso porcentual disponible.</p>}
    </div>
    {(state.phase === "previewing" || state.phase === "writing") && <progress aria-label={state.phase === "writing" ? "Filas con resultado recibido" : "Filas previsualizadas"} max={Math.max(1, state.progress.total)} value={state.progress.received} className="mt-3 h-3 w-full accent-[#245c4c]" />}
    {state.formatWarning && <div role="status" className="mt-4 rounded-lg border border-[#bccdbf] p-4 text-sm text-[#35473d]">
      <p>{state.formatWarning.affected} de {state.formatWarning.total} filas no tienen SKU o Modelo guardados como texto.</p>
      <p className="mt-2">{importTextHelp}</p>
      {!state.formatWarning.canContinue && <p className="mt-2">No hay filas válidas para continuar.</p>}
      <div className="mt-3 flex flex-wrap gap-3">
        {state.formatWarning.canContinue && <button type="button" className={button} disabled={archived || state.failure?.status === 401} onClick={() => { void flow.startPreview(); }}>Continuar con las filas válidas</button>}
        <button type="button" className={button} onClick={() => { document.getElementById("product-import-file")?.focus(); }}>Corregir el archivo</button>
      </div>
      <p className="mt-2">Corrige el archivo en Excel y vuelve a seleccionarlo con el selector de arriba.</p>
    </div>}
    {state.failure && <div role="alert" className="mt-4 rounded-lg border border-[#f0c8b9] bg-[#fff4ef] p-4 text-sm text-[#963b23]"><p>{state.failure.message}</p>{state.failure.requestId && <p className="mt-2 break-all">Referencia de soporte: {state.failure.requestId}</p>}{state.failure.status === 401 && !busy && <Link href="/login" className="mt-3 inline-block font-semibold underline focus-visible:outline-2">Volver a iniciar sesión</Link>}</div>}
    <div className="mt-4 flex flex-wrap gap-3">
      {(state.phase === "reading" || state.phase === "previewing") && <button type="button" className={button} onClick={() => flow.cancel()}>{state.phase === "reading" ? "Cancelar lectura" : "Cancelar vista previa"}</button>}
      {state.phase === "writing" && <button type="button" className={button} onClick={() => flow.stop()} disabled={state.stopRequested}>{state.stopRequested ? "Detención solicitada: esperando el lote actual" : "Detener después del lote actual"}</button>}
      {state.phase === "ready" && <button type="button" className={`${button} bg-[#245c4c] text-white hover:bg-[#194638]`} disabled={!eligible || expired || archived} onClick={() => { void flow.confirm(); }}>Importar {eligible} productos</button>}
      {state.failure?.retryable && !busy && <button type="button" className={button} disabled={retrySeconds > 0 || archived || (state.failure.stage === "confirm" && expired)} onClick={() => { void flow.retry(); }}>Reintentar {state.failure.stage === "preview" ? "vista previa" : "lote rechazado"}</button>}
      {!busy && state.report.some(row => !row.local && row.status !== "created" && row.status !== "updated") && state.phase !== "idle" && <button type="button" className={button} disabled={archived || state.failure?.status === 401 || retrySeconds > 0} onClick={() => { void flow.startPreview(); }}>Nueva vista previa de filas sin confirmar</button>}
      {retrySeconds > 0 && <span aria-live="off" className="self-center text-sm text-[#52655a]">Podrás reintentar en {retrySeconds} s.</span>}
    </div>
    {expired && !busy && state.phase === "ready" && <p role="alert" className="mt-3 text-sm text-[#963b23]">La vista previa caducó. Genera una nueva para confirmar.</p>}
    <h3 ref={summary} tabIndex={-1} className="mt-6 text-lg font-semibold text-[#202b27] focus-visible:outline-2">Revisión y reporte</h3>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Nuevas (vista previa)", counts.new], ["Actualizar (vista previa)", counts.updates], ["Creadas", counts.created], ["Actualizadas", counts.updated], ["Filas con error", counts.errors], ["No procesadas", counts.notProcessed], ["Resultado desconocido", counts.unknown], ["Sin clasificar", counts.waiting]].map(([label, count]) => <div key={label} className="rounded-lg border border-[#e2e8e0] p-3"><dt className="text-xs text-[#52655a]">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-[#202b27]">{count}</dd></div>)}
    </dl>
    <p className="mt-3 text-sm text-[#52655a]">Cada fila cuenta una sola vez, aunque tenga varios errores. Corrige el archivo y vuelve a leerlo para cambiar datos. Una nueva vista previa excluye las filas que este reporte ya confirma como guardadas.</p>
    {state.report.length > 0 && <>
      <div role="region" aria-label="Detalle de filas de la importación" tabIndex={0} className="mt-4 overflow-x-auto rounded-lg border border-[#e2e8e0] focus-visible:outline-2 focus-visible:outline-[#245c4c]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption ref={tableTitle} tabIndex={-1} className="p-3 text-left font-semibold text-[#202b27]">Detalle por fila de Excel · Página {currentPage + 1} de {pages}</caption>
          <thead className="bg-[#f2f6f0] text-[#35473d]"><tr>{["Fila", "Nombre", "SKU", "Acción", "Motivo y referencia"].map(header => <th key={header} scope="col" className="px-3 py-3">{header}</th>)}</tr></thead>
          <tbody>{state.report.slice(currentPage * 25, currentPage * 25 + 25).map(row => <tr key={row.rowNumber} className="border-t border-[#e2e8e0] align-top text-[#35473d]"><th scope="row" className="px-3 py-3 tabular-nums">{row.rowNumber}</th><td className="max-w-56 break-words px-3 py-3">{row.name || "Sin nombre"}</td><td className="max-w-40 break-all px-3 py-3">{row.sku || "—"}</td><td className="px-3 py-3 font-semibold">{statusLabels[row.status]}</td><td className="max-w-md break-words px-3 py-3">{row.reasons.map((reason, index) => <p key={index} className="mb-1">{reason}</p>)}{row.textHelp && <p className="mt-2 text-xs leading-5">Ayuda: {importTextHelp}</p>}{row.fields.length > 0 && <p>Campos: {row.fields.map(importFieldLabel).join(", ")}.</p>}{row.requestId && <p className="mt-2 break-all text-xs">requestId: {row.requestId}</p>}</td></tr>)}</tbody>
        </table>
      </div>
      <nav aria-label="Páginas del reporte de importación" className="mt-3 flex items-center gap-3"><button type="button" className={button} disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>Anterior</button><span className="text-sm text-[#52655a]">{currentPage + 1} / {pages}</span><button type="button" className={button} disabled={currentPage === pages - 1} onClick={() => changePage(currentPage + 1)}>Siguiente</button></nav>
    </>}
  </section>;
}
