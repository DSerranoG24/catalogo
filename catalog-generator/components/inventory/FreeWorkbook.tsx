"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createUniver, CommandType, LifecycleStages, LocaleType, mergeLocales, type IWorkbookData } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import Spanish from "@univerjs/preset-sheets-core/locales/es-ES";
import FilterSpanish from "@univerjs/preset-sheets-filter/locales/es-ES";
import SortSpanish from "@univerjs/preset-sheets-sort/locales/es-ES";
import FindSpanish from "@univerjs/preset-sheets-find-replace/locales/es-ES";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import { apiRequest } from "@/lib/api";
import WorkbookReading from "./WorkbookReading";

type Document = { snapshot: string; version: number; updatedAt: string };
type Save = { expectedVersion: number | null; operationId: string; snapshot: string };
type Editor = ReturnType<typeof createUniver>;

export default function FreeWorkbook() {
  const host = useRef<HTMLDivElement>(null), editor = useRef<Editor | null>(null);
  const version = useRef<number | null>(null), pending = useRef<{ input: Save; revision: number } | null>(null), changes = useRef(0), saving = useRef(false);
  const [ready, setReady] = useState(false), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("Mi inventario");
  useEffect(() => {
    const controller = new AbortController(), container = document.createElement("div"); container.style.height = "100%";
    let instance: Editor | null = null;
    apiRequest<{ result: Document | null }>("/inventory/workbook", { signal: controller.signal }).then(async ({ result }) => {
      if (controller.signal.aborted || !host.current) return;
      host.current.append(container);
      // Desktop cell editing needs the SDK's normal focus transfer when typing.
      instance = createUniver({ locale: LocaleType.ES_ES, locales: { [LocaleType.ES_ES]: mergeLocales(Spanish, FilterSpanish, SortSpanish, FindSpanish) }, presets: [UniverSheetsCorePreset({ container }), UniverSheetsFilterPreset(), UniverSheetsSortPreset(), UniverSheetsFindReplacePreset()] });
      // Native SDK snapshot: our API bounds/validates its JSON envelope and dimensions.
      // Its version-specific cell/style metadata stays opaque; no inventory interpretation occurs here.
      const data = result ? JSON.parse(result.snapshot) as IWorkbookData : { id: "vitrinaya-workbook", name: "Mi inventario", sheetOrder: ["principal"], sheets: { principal: { id: "principal", name: "Hoja 1", rowCount: 500, columnCount: 26 } } };
      const workbook = instance.univerAPI.createWorkbook(data);
      const initialized = instance;
      await new Promise<void>(resolve => {
        if (initialized.univerAPI.getCurrentLifecycleStage() >= LifecycleStages.Steady) return resolve();
        const listener = initialized.univerAPI.addEvent(initialized.univerAPI.Event.LifeCycleChanged, ({ stage }) => { if (stage >= LifecycleStages.Steady) { listener.dispose(); resolve(); } });
        controller.signal.addEventListener("abort", () => { listener.dispose(); resolve(); }, { once: true });
      });
      if (controller.signal.aborted) return;
      version.current = result?.version ?? null; editor.current = instance; setName(workbook.getName());
      workbook.onCommandExecuted(command => {
        // Formula-engine bookkeeping is derived data, not a later user edit.
        if (command.type === CommandType.MUTATION && !command.id.startsWith("formula.mutation.")) { changes.current++; setDirty(true); }
      });
      setReady(true); setError(""); setMessage(result ? `Hoja recuperada · versión ${result.version}.` : "Hoja nueva. Escribe tus títulos y datos en cualquier celda.");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar la hoja."); });
    return () => { controller.abort(); editor.current = null; queueMicrotask(() => { instance?.univer.dispose(); container.remove(); }); };
  }, [attempt]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function snapshot() {
    const workbook = editor.current?.univerAPI.getActiveWorkbook(); if (!workbook) throw new Error("Espera a que termine de cargar la hoja.");
    await workbook.endEditingAsync(true);
    const title = name.trim() || "Mi inventario"; if (workbook.getName() !== title) workbook.setName(title);
    try { await editor.current?.univerAPI.getFormula().onCalculationResultApplied(5000); }
    catch { throw new Error("La hoja sigue calculando fórmulas. Espera unos segundos y vuelve a guardar."); }
    return JSON.stringify(workbook.save());
  }
  async function save() {
    if (saving.current || !ready) return; saving.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const text = pending.current ? null : await snapshot();
      if (text && new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error("La hoja supera 2 MiB. Descarga una copia y reduce su tamaño antes de guardar.");
      const operation = pending.current ?? { input: { snapshot: text ?? "", expectedVersion: version.current, operationId: crypto.randomUUID() }, revision: changes.current };
      pending.current = operation; const input = operation.input, captured = operation.revision;
      const { result } = await apiRequest<{ result: { version: number; replayed: boolean } }>("/inventory/workbook", { method: "PUT", body: JSON.stringify(input) });
      version.current = result.version; pending.current = null;
      if (captured === changes.current) setDirty(false);
      setMessage(captured === changes.current ? `Hoja guardada · versión ${result.version}. Los datos se conservaron como documento libre.` : `Versión ${result.version} guardada. Quedan cambios posteriores sin guardar; pulsa Guardar hoja de nuevo.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar. Reintenta sin cerrar la hoja."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function backup() {
    try {
      const text = await snapshot(), url = URL.createObjectURL(new Blob([text], { type: "application/json" })), link = document.createElement("a");
      link.href = url; link.download = "mi-inventario.vitrinaya.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Copia del documento descargada en formato Vitrinaya JSON.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo descargar."); }
  }
  return <main className="mx-auto max-w-[1800px] space-y-3 px-3 py-5 sm:px-6">
    <Link className="inline-flex min-h-11 items-center underline" href="/dashboard/inventario" onClick={event => { if (dirty) { event.preventDefault(); setError("Guarda o descarga una copia de tus cambios antes de salir."); } }}>← Inventario</Link>
    <div className="flex flex-wrap items-end gap-3"><div className="flex-1"><h1 className="text-2xl font-semibold">Hoja de cálculo</h1><p className="mt-1 text-sm">Tus títulos, tus columnas y tu organización. Edita y arrastra dentro de la hoja; guarda cuando termines.</p></div>
      <label className="text-sm">Nombre del documento<input className="block min-h-11 rounded border bg-white px-3" maxLength={160} value={name} disabled={!ready || busy} onChange={event => { setName(event.target.value); changes.current++; setDirty(true); }} /></label>
      <button className="min-h-11 rounded bg-[#173d2a] px-4 font-semibold text-white disabled:opacity-50" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar hoja"}</button>
      <button className="min-h-11 rounded border px-4 disabled:opacity-50" disabled={!ready || busy} onClick={() => void backup()}>Descargar copia</button>
    </div>
    <p className="text-sm">{dirty ? "Cambios sin guardar." : "Sin guardado automático."} Esta hoja todavía no crea productos ni modifica las existencias registradas.</p>
    <p role="status" aria-live="polite">{message}</p>
    {error && <div role="alert" className="rounded border border-red-400 p-3 text-red-900"><p>{error}</p>{!ready && <button className="min-h-11 underline" onClick={() => setAttempt(value => value + 1)}>Reintentar carga</button>}</div>}
    {!ready && !error && <p role="status">Cargando hoja de cálculo…</p>}
    <div ref={host} aria-label="Editor de hoja de cálculo" aria-busy={!ready} className={`h-[78dvh] min-h-[500px] w-full overflow-hidden rounded border bg-white ${ready ? "" : "pointer-events-none"}`} />
    <WorkbookReading getSnapshot={snapshot} getActiveSheetId={() => editor.current?.univerAPI.getActiveWorkbook()?.getActiveSheet().getSheetId() ?? null} ready={ready && !busy} />
    <details><summary className="min-h-11 cursor-pointer">Ayuda y herramientas anteriores</summary><p className="text-sm">Escribe títulos en la primera fila o donde prefieras. Usa la barra de fórmulas, menús y clic derecho para formato, combinar, insertar, eliminar, mover filas/columnas y organizar pestañas. Arrastra la selección o sus controles de relleno y cambia tamaños desde las cabeceras.</p><Link className="inline-flex min-h-11 items-center underline" href="/dashboard/inventario/lotes" onClick={event => { if (dirty) { event.preventDefault(); setError("Guarda o descarga una copia de tus cambios antes de salir."); } }}>Abrir herramientas de importación y ajustes estructurados</Link></details>
  </main>;
}
