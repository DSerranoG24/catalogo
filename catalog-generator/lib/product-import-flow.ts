import { IMPORT_COLUMNS, ImportReadError, type ImportReadResult, type ImportRow } from "./product-import/contracts";
import { ImportRequestError, type BatchReply, type ImportBatchBody, type ServerRow } from "./product-import-api";

export type ImportPhase = "idle" | "reading" | "previewing" | "ready" | "writing" | "stopped" | "completed" | "error";
export type RowStatus = "waiting" | "new" | "update" | "created" | "updated" | "error" | "not_processed" | "unknown";
export type ReportRow = { rowNumber: number; name: string; sku: string; status: RowStatus; reasons: string[]; fields: string[]; local: boolean; requestId?: string; textHelp?: boolean };
type Failure = { stage: "read" | "preview" | "confirm"; status: number; message: string; requestId?: string; retryAt: number; retryable: boolean };
export type ImportFlowState = {
  open: boolean; phase: ImportPhase; fileName: string; report: ReportRow[];
  progress: { batch: number; batches: number; received: number; total: number };
  formatWarning?: { affected: number; total: number; canContinue: boolean };
  notice: string; failure?: Failure; expiresAt: number; stopRequested: boolean;
};
type Dependencies = {
  read: (file: File, options: { signal: AbortSignal }) => Promise<ImportReadResult>;
  request: (catalogId: string, mode: "preview" | "confirm", body: ImportBatchBody, signal?: AbortSignal) => Promise<BatchReply>;
  refresh: () => void;
  now?: () => number;
};
const initial = (): ImportFlowState => ({ open: false, phase: "idle", fileName: "", report: [], progress: { batch: 0, batches: 0, received: 0, total: 0 }, formatWarning: undefined, notice: "", expiresAt: 0, stopRequested: false });
export const importTextHelp = "Selecciona la columna, aplica formato Texto antes de escribir y reescribe los valores. Cambiar el formato después no convierte los existentes. También puedes escribir '1001 para guardar 1001 como texto.";
export const importBusy = (phase: ImportPhase) => phase === "reading" || phase === "previewing" || phase === "writing";
const written = (status: RowStatus) => status === "created" || status === "updated";
const localReasons = { TEXT_REQUIRED: "Debe estar guardado como texto en Excel; no se convierten códigos ni fechas numéricas.", NUMBER_REQUIRED: "Debe ser una celda numérica.", BOOLEAN_REQUIRED: "Selecciona Sí, No o deja la celda vacía.", FORMULA_NOT_ALLOWED: "No se admiten fórmulas; introduce el valor directamente." };
export const importFieldLabel = (field: string) => IMPORT_COLUMNS.find(([, key]) => key === field)?.[0] ?? field;

export function importCounts(report: ReportRow[]) {
  const result = { new: 0, updates: 0, created: 0, updated: 0, errors: 0, notProcessed: 0, unknown: 0, waiting: 0 };
  for (const row of new Map(report.map(row => [row.rowNumber, row])).values()) {
    const key = row.status === "update" ? "updates" : row.status === "error" ? "errors" : row.status === "not_processed" ? "notProcessed" : row.status;
    result[key]++;
  }
  return result;
}

// Reserve the maximum signed token size BEFORE preview, so later batches fit as it grows.
const ROWS_BYTES = 2 * 1024 * 1024 - 524288 - 2048;
export function importBatches(rows: ImportRow[]): ImportRow[][] {
  const batches: ImportRow[][] = [];
  let batch: ImportRow[] = [], bytes = 2;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (size > ROWS_BYTES) throw new Error("ROW_TOO_LARGE");
    if (batch.length === 50 || bytes + size > ROWS_BYTES) { batches.push(batch); batch = []; bytes = 2; }
    batch.push(row); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export class ProductImportFlow {
  private state = initial();
  private listeners = new Set<() => void>();
  private source: ImportRow[] = [];
  private preview?: { batches: ImportRow[][]; index: number; token?: string; total: number };
  private confirmation?: { batches: ImportRow[][]; index: number; token: string; total: number };
  private active?: AbortController;
  private disposed = false;
  private readonly now: () => number;
  constructor(private readonly catalogId: string, private readonly deps: Dependencies) { this.now = deps.now ?? Date.now; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(patch: Partial<ImportFlowState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener());
  }
  private updateRows(work: (rows: Map<number, ReportRow>) => void) {
    const rows = new Map(this.state.report.map(row => [row.rowNumber, row])); work(rows);
    this.patch({ report: [...rows.values()].sort((a, b) => a.rowNumber - b.rowNumber) });
  }
  open() { if (!this.disposed) this.patch({ open: true }); }
  activate() { this.disposed = false; }
  close() { if (importBusy(this.state.phase)) return false; this.patch({ open: false }); return true; }
  dispose() { this.disposed = true; if (this.state.phase !== "writing") this.active?.abort(); this.listeners.clear(); }
  cancel() {
    if (this.state.phase === "reading" || this.state.phase === "previewing") this.active?.abort();
  }
  stop() { if (this.state.phase === "writing") this.patch({ stopRequested: true, notice: "Se detendrá al recibir el resultado del lote actual. Lo guardado se conserva." }); }
  sessionExpired() {
    if (this.state.phase === "writing") this.patch({ stopRequested: true, notice: "Sesión expirada. Se esperará el resultado del lote actual y no se enviarán más.", failure: { stage: "confirm", status: 401, message: "Tu sesión ha expirado. El reporte permanece visible hasta que salgas de esta página.", retryAt: 0, retryable: false } });
    else { this.active?.abort(); this.fail(new ImportRequestError(401, "AUTH_REQUIRED", false), "confirm"); }
  }
  async select(file: File) {
    if (importBusy(this.state.phase) || this.disposed || this.state.failure?.status === 401 || this.now() < (this.state.failure?.retryAt ?? 0)) return;
    this.source = []; this.preview = undefined; this.confirmation = undefined;
    this.patch({ ...initial(), open: true, phase: "reading", fileName: file.name, notice: "Leyendo archivo… No se envía el archivo al servidor." });
    const controller = new AbortController(); this.active = controller;
    try {
      const result = await this.deps.read(file, { signal: controller.signal });
      if (this.disposed || controller.signal.aborted) return this.cancelled();
      const rows = new Map<number, ReportRow>();
      for (const row of result.rows) {
        const tooLarge = new TextEncoder().encode(JSON.stringify(row)).length + 1 > ROWS_BYTES;
        rows.set(row.rowNumber, { rowNumber: row.rowNumber, name: row.name, sku: row.sku ?? "", status: tooLarge ? "error" : "waiting", reasons: tooLarge ? ["Esta fila supera el tamaño permitido para una petición JSON."] : [], fields: [], local: tooLarge });
        if (!tooLarge) this.source.push(row);
      }
      const rejected = new Map(result.rejectedRows.map(row => [row.rowNumber, row]));
      for (const issue of result.errors) {
        const previous = rows.get(issue.rowNumber);
        rows.set(issue.rowNumber, { rowNumber: issue.rowNumber, name: previous?.name ?? rejected.get(issue.rowNumber)?.name ?? "No disponible", sku: previous?.sku ?? rejected.get(issue.rowNumber)?.sku ?? "No disponible", status: "error", reasons: [...(previous?.reasons ?? []), `${importFieldLabel(issue.field)}: ${localReasons[issue.code]}`], fields: [...new Set([...(previous?.fields ?? []), issue.field])], local: true, textHelp: previous?.textHelp || (issue.code === "TEXT_REQUIRED" && (issue.field === "sku" || issue.field === "model")) });
      }
      this.patch({ report: [...rows.values()].sort((a, b) => a.rowNumber - b.rowNumber), phase: "idle", notice: result.totalRows ? "Lectura terminada. Preparando la vista previa." : "El archivo no contiene filas de productos." });
      const affected = new Set(result.errors.filter(issue => issue.code === "TEXT_REQUIRED" && (issue.field === "sku" || issue.field === "model")).map(issue => issue.rowNumber)).size;
      if (affected) this.patch({ phase: "idle", formatWarning: { affected, total: result.totalRows, canContinue: this.source.length > 0 }, notice: "Revisa el formato antes de continuar." });
      else if (this.source.length) await this.startPreview();
      else this.patch({ phase: "completed", notice: "No hay filas válidas para enviar. Revisa los errores o completa la plantilla." });
    } catch (error) {
      if (controller.signal.aborted) this.cancelled();
      else this.patch({ phase: "error", failure: { stage: "read", status: 0, message: error instanceof ImportReadError ? error.message : "No se pudo leer el archivo.", retryAt: 0, retryable: false }, notice: "No se escribió ningún producto." });
    } finally { if (this.active === controller) this.active = undefined; }
  }
  private cancelled() {
    if (this.state.failure?.status === 401) { this.patch({ phase: "error" }); return; }
    this.patch({ phase: "stopped", failure: undefined, notice: "Operación cancelada. Esta lectura o vista previa no escribió productos." });
  }
  async startPreview() {
    if (importBusy(this.state.phase) || this.disposed || this.state.failure?.status === 401 || this.now() < (this.state.failure?.retryAt ?? 0)) return;
    const eligible = this.source.filter(row => !written(this.state.report.find(item => item.rowNumber === row.rowNumber)?.status ?? "waiting"));
    if (!eligible.length) return;
    this.confirmation = undefined;
    this.preview = { batches: importBatches(eligible), index: 0, total: eligible.length };
    this.updateRows(rows => { for (const row of eligible) { const old = rows.get(row.rowNumber); if (old) rows.set(row.rowNumber, { ...old, status: "waiting", reasons: [], fields: [], requestId: undefined }); } });
    this.patch({ expiresAt: this.now() + 30 * 60_000, failure: undefined, formatWarning: undefined });
    await this.runPreview();
  }
  async retry() {
    const failure = this.state.failure;
    if (!failure?.retryable || this.now() < failure.retryAt || importBusy(this.state.phase)) return;
    if (failure.stage === "preview") await this.runPreview();
    else if (failure.stage === "confirm") await this.runConfirmation();
  }
  private fail(error: unknown, stage: "preview" | "confirm") {
    const request = error instanceof ImportRequestError ? error : new ImportRequestError(0, "CONNECTION_LOST", stage === "confirm");
    const retryable = stage === "preview" ? request.status === 429 || request.status === 0 || request.status >= 500 : request.status === 429;
    const message = request.status === 401 ? "Tu sesión ha expirado. No se enviarán más lotes. El reporte permanece visible hasta que salgas de esta página."
      : request.status === 429 ? "Se alcanzó el límite de solicitudes. Espera y reintenta este lote con el botón; no se reenvía automáticamente."
      : request.code === "INVALID_IMPORT_PREVIEW" ? "La vista previa caducó o dejó de ser válida. Genera una nueva antes de confirmar."
      : request.status === 409 ? "El catálogo o la vista previa cambiaron. Revisa el reporte y genera una nueva vista previa."
      : request.status === 404 ? "El catálogo no está disponible para esta cuenta."
      : request.uncertain ? "Se perdió una respuesta de escritura. El lote puede haberse guardado; su resultado es desconocido. No se reenviará automáticamente."
      : "No se pudo completar este lote. Revisa el reporte antes de continuar.";
    this.patch({ phase: "error", failure: { stage, status: request.status, message, requestId: request.requestId, retryable, retryAt: request.status === 429 ? this.now() + request.retrySeconds * 1000 : 0 }, notice: stage === "preview" ? "La vista previa está incompleta: no puedes confirmar todavía." : "Los resultados confirmados de los lotes anteriores se conservan." });
    return request;
  }
  private apply(rows: ServerRow[], requestId: string, confirming: boolean) {
    this.updateRows(report => {
      for (const row of rows) {
        const old = report.get(row.rowNumber); if (!old) continue;
        const status: RowStatus = row.action === "create" ? confirming ? "created" : "new" : row.action === "update" ? confirming ? "updated" : "update" : row.action;
        report.set(row.rowNumber, { ...old, status, reasons: [confirming && row.action === "create" ? "Producto creado." : confirming && row.action === "update" ? "Producto actualizado." : row.reason], fields: row.fields ?? [], requestId });
      }
    });
  }
  private async runPreview() {
    const context = this.preview; if (!context || this.disposed) return;
    const controller = new AbortController(); this.active = controller;
    this.patch({ phase: "previewing", failure: undefined, notice: "Consultando la clasificación. Aún no se guardan productos." });
    try {
      for (; context.index < context.batches.length; context.index++) {
        const rows = context.batches[context.index];
        this.patch({ progress: { batch: context.index + 1, batches: context.batches.length, received: context.batches.slice(0, context.index).reduce((sum, batch) => sum + batch.length, 0), total: context.total } });
        const reply = await this.deps.request(this.catalogId, "preview", { rows, totalRows: context.total, ...(context.token ? { previewToken: context.token } : {}) }, controller.signal);
        if (this.disposed || controller.signal.aborted) return this.cancelled();
        if (!reply.previewToken || reply.ready !== (context.index === context.batches.length - 1)) throw new ImportRequestError(0, "INVALID_RESPONSE", false);
        context.token = reply.previewToken;
        this.apply(reply.rows, reply.requestId, false);
        this.updateRows(report => { for (const number of reply.invalidatedRows ?? []) { const old = report.get(number); if (old && !old.local && !written(old.status)) report.set(number, { ...old, status: "error", reasons: ["Varias filas del archivo comparten identidad o apuntan al mismo producto."], requestId: reply.requestId }); } });
      }
      this.patch({ phase: "ready", progress: { batch: context.batches.length, batches: context.batches.length, received: context.total, total: context.total }, notice: "Vista previa completa. Revisa nuevas, actualizaciones y errores antes de confirmar." });
    } catch (error) { if (controller.signal.aborted) this.cancelled(); else this.fail(error, "preview"); }
    finally { if (this.active === controller) this.active = undefined; }
  }
  async confirm() {
    if (this.state.phase !== "ready" || !this.preview?.token || this.disposed) return;
    if (this.now() >= this.state.expiresAt) { this.fail(new ImportRequestError(409, "INVALID_IMPORT_PREVIEW", false), "confirm"); return; }
    const ids = new Set(this.state.report.filter(row => row.status === "new" || row.status === "update").map(row => row.rowNumber));
    const rows = this.source.filter(row => ids.has(row.rowNumber)); if (!rows.length) return;
    this.confirmation = { batches: importBatches(rows), index: 0, token: this.preview.token, total: this.preview.total };
    await this.runConfirmation();
  }
  private async runConfirmation() {
    const context = this.confirmation; if (!context || this.disposed) return;
    if (this.now() >= this.state.expiresAt) { this.fail(new ImportRequestError(409, "INVALID_IMPORT_PREVIEW", false), "confirm"); return; }
    this.patch({ phase: "writing", stopRequested: false, failure: undefined, notice: "Guardando por lotes. Lo confirmado no se deshace al detener." });
    let attempted = false;
    try {
      for (; context.index < context.batches.length; context.index++) {
        if (this.disposed || this.state.stopRequested) break;
        const rows = context.batches[context.index];
        this.patch({ progress: { batch: context.index + 1, batches: context.batches.length, received: context.batches.slice(0, context.index).reduce((sum, batch) => sum + batch.length, 0), total: context.batches.flat().length } });
        try {
          attempted = true;
          const reply = await this.deps.request(this.catalogId, "confirm", { rows, totalRows: context.total, previewToken: context.token });
          if (this.disposed) return;
          this.apply(reply.rows, reply.requestId, true);
        } catch (error) {
          if (this.disposed) return;
          const failure = this.fail(error, "confirm");
          this.updateRows(report => {
            const affected = new Set(rows.map(row => row.rowNumber));
            for (const [number, old] of report) if (old.status === "new" || old.status === "update" || old.status === "not_processed") {
              report.set(number, { ...old, status: affected.has(number) && failure.uncertain ? "unknown" : "not_processed", reasons: [affected.has(number) && failure.uncertain ? "Puede haberse guardado; se requiere nueva vista previa." : "No se confirmó esta fila."], requestId: affected.has(number) ? failure.requestId : undefined });
            }
          });
          return;
        }
      }
      this.updateRows(report => { for (const [number, row] of report) if (row.status === "new" || row.status === "update") report.set(number, { ...row, status: "not_processed", reasons: ["No se envió: se detuvo antes de este lote."], requestId: undefined }); });
      const stopped = context.index < context.batches.length;
      this.patch({ phase: stopped ? "stopped" : "completed", progress: { ...this.state.progress, received: context.batches.slice(0, context.index).reduce((sum, batch) => sum + batch.length, 0) }, notice: stopped ? "Importación detenida. Los lotes ya confirmados permanecen guardados." : "Importación terminada. Revisa también los errores y las filas no procesadas." });
    } finally {
      if (attempted && !this.disposed) {
        try { this.deps.refresh(); } catch { this.patch({ notice: `${this.state.notice} No se pudo actualizar el listado; el reporte se conserva.` }); }
      }
    }
  }
}
