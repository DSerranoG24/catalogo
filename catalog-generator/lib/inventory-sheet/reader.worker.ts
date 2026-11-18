/// <reference lib="webworker" />
import { readInventoryWorkbook, parseDelimited } from "./formats";
const scope = self as unknown as DedicatedWorkerGlobalScope;
Object.defineProperty(scope, "Worker", { value: undefined, writable: false });
Object.defineProperty(scope, "fetch", { value: () => { throw new Error("Lectura de red no permitida."); }, writable: false });
scope.onmessage = async (event: MessageEvent<{ file: File; delimiter: string }>) => {
  try {
    const { file, delimiter } = event.data;
    if (!(file instanceof File)) throw new Error("Selecciona un archivo.");
    if (/\.xlsx$/i.test(file.name)) {
      if (file.size > 5 * 1024 * 1024) throw new Error("Máximo 5 MiB por XLSX.");
      const { readSheet } = await import("read-excel-file/web-worker");
      scope.postMessage({ ok: true, ...await readInventoryWorkbook(new Uint8Array(await file.arrayBuffer()), (data, sheet) => readSheet(data, sheet)) });
    } else if (/\.csv$/i.test(file.name)) {
      if (file.size > 2 * 1024 * 1024) throw new Error("Máximo 2 MiB por CSV.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      scope.postMessage({ ok: true, matrix: parseDelimited(text, delimiter), hidden: false });
    } else throw new Error("Solo se admiten archivos XLSX y CSV.");
  } catch (error) { scope.postMessage({ ok: false, message: error instanceof Error ? error.message : "No se pudo leer el archivo." }); }
  finally { scope.close(); }
};
