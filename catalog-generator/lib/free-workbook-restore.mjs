export function validateNativeWorkbookCopy(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("La copia está vacía.");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !Array.isArray(value.sheetOrder) || !value.sheetOrder.length || !value.sheets || typeof value.sheets !== "object") throw new Error("La copia no tiene una estructura compatible.");
  return text;
}
