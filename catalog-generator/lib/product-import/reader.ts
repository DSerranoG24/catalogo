"use client";

import { startImportRead } from "./reader-controller";

/** Local processing only. The caller owns AbortController and presentation of row issues. */
export function readProductImport(file: File, options: { signal?: AbortSignal } = {}) {
  return startImportRead(file, options.signal, () => new Worker(new URL("./reader.worker.ts", import.meta.url), { type: "module" }));
}
