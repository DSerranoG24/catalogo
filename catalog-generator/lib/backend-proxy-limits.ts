const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function backendBodyLimit(method: string, path: string[], contentType: string | null) {
  const json = contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
  if (method === "POST" && json && path.length === 5 && path[0] === "products" && path[1] === "catalog" &&
      UUID.test(path[2]) && path[3] === "import" && (path[4] === "preview" || path[4] === "confirm")) return 2 * 1024 * 1024;
  return contentType?.startsWith("multipart/form-data") ? 5 * 1024 * 1024 + 64 * 1024 : 64 * 1024;
}
