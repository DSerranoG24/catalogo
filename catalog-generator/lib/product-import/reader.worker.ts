/// <reference lib="webworker" />

import { ImportReadError, requireImportFile, safeReadError } from "./contracts";

const scope = self as unknown as DedicatedWorkerGlobalScope;
// This worker is the complete cancellation boundary. The sanitized ZIP uses STORE,
// and this version's XML parser runs locally. Fail closed if a dependency tries to
// introduce child workers in the future: no untracked worker may outlive termination.
Object.defineProperty(scope, "Worker", { value: undefined, writable: false, configurable: false });
Object.defineProperty(scope, "fetch", { value: () => { throw new ImportReadError("READ_FAILED"); }, writable: false });
scope.onmessage = async (event: MessageEvent<unknown>) => {
  scope.onmessage = null;
  try {
    if (!(event.data instanceof File)) throw new ImportReadError("XLSX_REQUIRED");
    requireImportFile(event.data);
    // Load dependencies only after the no-child-worker boundary is installed.
    const { readSheet } = await import("read-excel-file/web-worker");
    const { readVerifiedWorkbook } = await import("./read-core");
    const bytes = new Uint8Array(await event.data.arrayBuffer());
    const result = await readVerifiedWorkbook(bytes, (input, sheet) => readSheet(input, sheet));
    scope.postMessage({ ok: true, result });
  } catch (error) { scope.postMessage({ ok: false, code: safeReadError(error) }); }
  finally { scope.close(); }
};
