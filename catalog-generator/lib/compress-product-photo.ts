export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export async function compressProductPhoto(file: File, options: { maxDimension?: number } = {}): Promise<File> {
  const maxDimension = options.maxDimension ?? 1800;
  if (!Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 2400) throw new Error("Dimensión de imagen no válida.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Solo JPG, PNG o WebP. Convierte HEIC antes de seleccionarlo.");
  if (file.size > 20 * 1024 * 1024 || file.size === 0) throw new Error("El archivo original debe ocupar entre 1 byte y 20 MiB.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("La imagen supera los 40 megapíxeles o no se puede leer.");
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Este navegador no permite preparar la imagen.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let compressed: Blob | null = null;
    for (const quality of [0.84, 0.7, 0.55, 0.4, 0.25]) {
      compressed = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
      if (!compressed) throw new Error("No se pudo comprimir la imagen.");
      if (compressed.size <= 300 * 1024) break;
    }
    if (!compressed || compressed.size > PHOTO_MAX_BYTES) throw new Error("La imagen sigue superando 2 MiB tras comprimir. Reduce sus dimensiones antes de subirla.");
    // WebP preserves alpha. Browsers without WebP encoding return PNG; never force JPEG.
    if (!["image/webp", "image/png"].includes(compressed.type)) throw new Error("El navegador devolvió un formato no permitido.");
    const name = file.name.replace(/\.[^.]+$/, "") + (compressed.type === "image/png" ? ".png" : ".webp");
    return new File([compressed], name, { type: compressed.type });
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
