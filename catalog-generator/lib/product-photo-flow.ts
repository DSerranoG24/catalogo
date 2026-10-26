export type PhotoResult = { name: string; status: "created" | "failed" | "unknown" | "not_processed"; message?: string; id?: string };
export async function uploadPhotoSequence(files: File[], deps: {
  prepare: (file: File) => Promise<File>;
  send: (file: File, index: number) => Promise<{ id: string }>;
  stopped: () => boolean;
  progress: (results: PhotoResult[], index: number) => void;
  fatal: (error: unknown) => boolean;
}) {
  if (files.length < 1 || files.length > 30) throw new Error("Selecciona entre 1 y 30 fotos.");
  const results: PhotoResult[] = [];
  let halt = false;
  for (const [index, file] of files.entries()) {
    if (halt || deps.stopped()) { results.push({ name: file.name, status: "not_processed" }); continue; }
    deps.progress([...results], index);
    let prepared: File;
    try { prepared = await deps.prepare(file); }
    catch (error) { results.push({ name: file.name, status: "failed", message: error instanceof Error ? error.message : "No se pudo preparar la imagen." }); deps.progress([...results], index + 1); continue; }
    // A stop during preparation does not start a request; a request already sent is awaited.
    if (deps.stopped()) { results.push({ name: file.name, status: "not_processed" }); continue; }
    try {
      const product = await deps.send(prepared, index);
      results.push({ name: file.name, status: "created", id: product.id });
    } catch (error) {
      // No automatic retry: the server may have committed despite a lost response.
      results.push({ name: file.name, status: "unknown", message: error instanceof Error ? error.message : "Respuesta desconocida. Revisa el listado." });
      halt = deps.fatal(error);
    }
    deps.progress([...results], index + 1);
  }
  return results;
}
