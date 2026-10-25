import { ImportReadError, ImportReadResult, isReadErrorCode, requireImportFile, XLSX_LIMITS } from "./contracts";

export type ReaderReply = { ok: true; result: ImportReadResult } | { ok: false; code: unknown };
type WorkerPort = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;

export function startImportRead(file: File, signal: AbortSignal | undefined, createWorker: () => WorkerPort): Promise<ImportReadResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ImportReadError("CANCELLED")); return; }
    // This check runs before either File.arrayBuffer() or creation of a worker.
    try { requireImportFile(file); } catch (error) { reject(error); return; }
    const started = performance.now();
    let worker: WorkerPort;
    try { worker = createWorker(); } catch { reject(new ImportReadError("READ_FAILED")); return; }
    let settled = false;
    const finish = (result?: ImportReadResult, error?: ImportReadError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      if (result) resolve(result); else reject(error ?? new ImportReadError("READ_FAILED"));
    };
    const cancel = () => finish(undefined, new ImportReadError("CANCELLED"));
    const timer = setTimeout(() => finish(undefined, new ImportReadError("TIMEOUT")), Math.max(0, XLSX_LIMITS.timeout - (performance.now() - started)));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<ReaderReply>) => {
      const reply = event.data;
      if (reply?.ok === true && reply.result && Array.isArray(reply.result.rows) && Array.isArray(reply.result.errors)) finish(reply.result);
      else finish(undefined, new ImportReadError(reply?.ok === false && isReadErrorCode(reply.code) ? reply.code : "READ_FAILED"));
    };
    worker.onerror = () => finish(undefined, new ImportReadError("READ_FAILED"));
    worker.onmessageerror = () => finish(undefined, new ImportReadError("READ_FAILED"));
    if (signal?.aborted) cancel();
    else {
      try { worker.postMessage(file); } catch { finish(undefined, new ImportReadError("READ_FAILED")); }
    }
  });
}
