import type { ImportRow } from "./product-import/contracts";

export type ImportBatchBody = { totalRows: number; rows: ImportRow[]; previewToken?: string };
export type ServerRow = { rowNumber: number; action: "create" | "update" | "error" | "not_processed";
  code: string; reason: string; fields?: string[]; productId?: string };
export type BatchReply = { requestId: string; rows: ServerRow[]; previewToken?: string; ready?: boolean; invalidatedRows?: number[] };
export class ImportRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly uncertain: boolean,
    public readonly requestId?: string, public readonly retrySeconds = 30) {
    super(code); this.name = "ImportRequestError";
  }
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const boundedText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const actions = new Set(["create", "update", "error", "not_processed"]);
function serverRow(value: unknown): value is ServerRow {
  return record(value) && Number.isInteger(value.rowNumber) && boundedText(value.action, 20) && actions.has(value.action)
    && boundedText(value.code, 100) && boundedText(value.reason, 1500)
    && (value.fields === undefined || (Array.isArray(value.fields) && value.fields.length <= 20 && value.fields.every(f => boundedText(f, 100))))
    && (value.productId === undefined || identifier(value.productId));
}
export function parseBatchReply(value: unknown, mode: "preview" | "confirm", expected: ImportRow[]): BatchReply {
  const invalid = () => new ImportRequestError(0, "INVALID_RESPONSE", mode === "confirm", record(value) && identifier(value.requestId) ? value.requestId : undefined);
  if (!record(value) || value.success !== true || !identifier(value.requestId) || !Array.isArray(value.rows) ||
      value.rows.length !== expected.length || !value.rows.every(serverRow)) throw invalid();
  const numbers = new Set(expected.map(row => row.rowNumber));
  for (const row of value.rows) { if (!numbers.delete(row.rowNumber)) throw invalid(); }
  if (numbers.size) throw invalid();
  const reply: BatchReply = { requestId: value.requestId, rows: value.rows };
  if (mode === "preview") {
    if (!boundedText(value.previewToken, 524288) || !value.previewToken || typeof value.ready !== "boolean" ||
        !Array.isArray(value.invalidatedRows) || value.invalidatedRows.length > 500 || !value.invalidatedRows.every(n => Number.isInteger(n) && Number(n) >= 2 && Number(n) <= 1048576)) throw invalid();
    reply.previewToken = value.previewToken; reply.ready = value.ready; reply.invalidatedRows = value.invalidatedRows;
  }
  return reply;
}

/** Import-only client: preserve safe error codes/requestId without changing other API consumers. */
export async function requestImportBatch(catalogId: string, mode: "preview" | "confirm", body: ImportBatchBody, signal?: AbortSignal): Promise<BatchReply> {
  const json = JSON.stringify(body);
  if (new TextEncoder().encode(json).length > 2 * 1024 * 1024) throw new ImportRequestError(413, "PAYLOAD_TOO_LARGE", false);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  // Separate from the 10-second local reader watchdog. The API has a 15s batch budget.
  const timer = setTimeout(abort, 30_000);
  try {
    const response = await fetch(`/api/backend/products/catalog/${encodeURIComponent(catalogId)}/import/${mode}`, {
      method: "POST", body: json, headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = record(payload) && typeof payload.error === "string" && /^[A-Z_]{1,100}$/.test(payload.error) ? payload.error : "REQUEST_FAILED";
      const requestId = record(payload) && identifier(payload.requestId) ? payload.requestId : undefined;
      const headerSeconds = Number(response.headers.get("retry-after"));
      const retry = headerSeconds > 0 && headerSeconds <= 900 ? headerSeconds : code === "IMPORT_BUSY" ? 2 : 900;
      // Only statuses that this API/proxy rejects before writing are known non-writes.
      // Gateways/timeouts or unexpected statuses must not be mistaken for a rollback.
      const rejectedBeforeWrite = [400, 401, 403, 404, 409, 413, 415, 429].includes(response.status);
      throw new ImportRequestError(response.status, code, mode === "confirm" && !rejectedBeforeWrite, requestId, retry);
    }
    return parseBatchReply(payload, mode, body.rows);
  } catch (error) {
    if (error instanceof ImportRequestError) throw error;
    throw new ImportRequestError(0, signal?.aborted ? "CANCELLED" : "CONNECTION_LOST", mode === "confirm");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
