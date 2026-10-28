import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { getJwtSecret } from "../utils/jwt";
import { bulkPreviewSchema, bulkConfirmSchema } from "../schemas/product-bulk.schema";
import { BulkProductError, makeProductBulkService } from "../services/product-bulk.service";

export function makeProductBulkRouter(auth: RequestHandler = authenticate, service = makeProductBulkService(), secret = getJwtSecret) {
  const router = Router({ mergeParams: true });
  router.use(auth);
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated" }));
  for (const mode of ["preview", "confirm"] as const) router.post(`/${mode}`, async (req: AuthenticatedRequest, res) => {
    res.set("Cache-Control", "private, no-store");
    const catalog = z.string().uuid().safeParse(req.params.catalogId);
    if (!req.user || !catalog.success) return res.status(400).json({ message: "Catálogo inválido." });
    const userId = req.user.id;
    try {
      const result = mode === "preview"
        ? await service.preview(catalog.data, userId, bulkPreviewSchema.parse(req.body), secret())
        : await (async () => { const input = bulkConfirmSchema.parse(req.body); return service.confirm(catalog.data, userId, input.token, secret(), input.confirmation); })();
      return res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Selecciona entre 1 y 96 productos únicos y revisa los campos del lote." });
      if (error instanceof BulkProductError) return res.status(409).json({ message: "El lote no se aplicó. Revisa los productos indicados.", issues: error.issues });
      const code = error instanceof Error ? error.message : "";
      if (code === "CATALOG_NOT_FOUND") return res.status(404).json({ message: "Catálogo no encontrado." });
      if (["CATALOG_ARCHIVED", "INVALID_BULK_PREVIEW", "BULK_CONFIRMATION_REQUIRED"].includes(code)) return res.status(409).json({ message: "Revisa el catálogo, genera una nueva vista previa y confirma la operación." });
      return res.status(503).json({ message: "No se pudo completar la operación. Si perdiste la respuesta, consulta el listado antes de reintentar." });
    }
  });
  return router;
}
