import { ErrorRequestHandler, RequestHandler } from "express";

export const routeNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ success: false, error: "ROUTE_NOT_FOUND" });
};

export const apiErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);

  const code = typeof error === "object" && error !== null
    ? "code" in error
      ? error.code
      : "type" in error
        ? error.type
        : undefined
    : undefined;

  if (code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: "FILE_TOO_LARGE" });
  }
  if (typeof code === "string" && code.startsWith("LIMIT_")) {
    return res.status(400).json({ success: false, error: "INVALID_UPLOAD" });
  }
  if (code === "INVALID_IMAGE_TYPE") {
    return res.status(400).json({ success: false, error: "INVALID_IMAGE_TYPE" });
  }
  if (code === "entity.parse.failed") {
    return res.status(400).json({ success: false, error: "INVALID_REQUEST_BODY" });
  }
  if (code === "entity.too.large") {
    return res.status(413).json({ success: false, error: "REQUEST_TOO_LARGE" });
  }

  console.error(error);
  return res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
};