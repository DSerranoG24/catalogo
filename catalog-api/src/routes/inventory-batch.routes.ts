import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { batchApplySchema, batchChunkSchema, batchCreateSchema, batchRevisionSchema, inventoryEditSchema, inventoryTermsSchema } from "../schemas/inventory-batch.schema";
import { editInventoryItem, makeInventoryBatchService, setInventoryTerms } from "../services/inventory-batch.service";
import { exportInventory, inventoryReportCsv } from "../services/inventory-export.service";
import { inventoryItemView, lockInventoryOwner } from "../repositories/inventory.repository";
import { prisma } from "../config/prisma";

const batch = makeInventoryBatchService();
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), filter: z.enum(["all", "NEW", "MODIFIED", "UNCHANGED", "ERROR", "EXCLUDED", "ADJUSTMENT"]).default("all") });
const exportSchema = z.object({ format: z.enum(["csv", "xlsx"]), q: z.string().trim().max(160).default(""), limit: z.coerce.number().int().min(1).max(10000).default(10000), cursor: z.uuid().optional(), segment: z.enum(["true", "false"]).default("false"), template: z.enum(["true", "false"]).default("false") }).strict();
function failure(error: unknown, res: Response) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "INVALID_INPUT", message: "Revisa los campos, límites y formato de la solicitud." });
  const code = error instanceof Error ? error.message : "UNKNOWN";
  const known: Record<string, [number, string]> = {
    ACCOUNT_CLOSED: [401, "Tu sesión ya no está disponible. Inicia sesión para continuar."], NOT_FOUND: [404, "No se encontró el recurso en tu cuenta."],
    VERSION_CONFLICT: [409, "Los datos cambiaron. Recarga el borrador y vuelve a previsualizar."], KEY_CONFLICT: [409, "La operación ya existe con otro contenido o revisión."],
    STALE_BATCH: [409, "El saldo o los datos cambiaron después de la vista previa. Previsualiza de nuevo; no se aplicó ninguna fila."],
    BATCH_NOT_READY: [409, "Corrige o excluye los errores y genera una vista previa antes de confirmar."], BATCH_INCOMPLETE: [409, "Faltan filas del lote. Completa la carga antes de previsualizar."],
    BATCH_TERMINAL: [409, "El lote ya está aplicado o cancelado. Consulta su resultado; no se volverá a aplicar."], BATCH_QUOTA: [429, "Tienes cinco lotes pendientes. Reanuda o cancela uno antes de crear otro."],
    BATCH_LIMIT: [413, "El lote excede 500 filas o su límite de tamaño. Divídelo explícitamente."], EXPORT_LIMIT: [413, "La exportación excede la cuota. Selecciona un segmento más pequeño; no se entregó un archivo truncado."],
  };
  const entry = known[code]; if (entry) return res.status(entry[0]).json({ code, message: entry[1] });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ code: "SKU_CONFLICT", message: "El SKU o identificador ya está en uso. Revisa y previsualiza nuevamente." });
  return res.status(503).json({ code: "RETRY_SAME_BATCH", message: "No se pudo completar la operación. Consulta el mismo lote antes de reintentar." });
}
export function makeInventoryBatchRouter() {
  const router = Router();
  const writes = rateLimit({ windowMs: 15 * 60_000, limit: 60, legacyHeaders: false, standardHeaders: "draft-8", keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated", message: { message: "Demasiadas operaciones de lote. Espera e inténtalo nuevamente." } });
  const exports = rateLimit({ windowMs: 15 * 60_000, limit: 6, legacyHeaders: false, standardHeaders: "draft-8", keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated", message: { message: "Espera antes de descargar otra exportación." } });
  type Work = (req: AuthenticatedRequest, userId: string) => Promise<unknown>;
  const handle = (work: Work) => async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.status(401).json({ message: "Sesión requerida" });
    try { return res.json({ success: true, result: await work(req, req.user.id) }); } catch (error) { return failure(error, res); }
  };
  const id = (req: AuthenticatedRequest) => z.uuid().parse(req.params.id);
  const small = express.json({ limit: "32kb" }), large = express.json({ limit: "256kb" });
  router.get("/batches", authenticate, handle((req, user) => batch.list(user, pageSchema.parse(req.query).page)));
  router.post("/batches", authenticate, writes, small, handle((req, user) => batch.create(user, batchCreateSchema.parse(req.body))));
  router.patch("/batches/:id/rows", authenticate, writes, (req, res, next) => {
    if (!z.uuid().safeParse(req.params.id).success) return res.status(400).json({ code: "INVALID_INPUT", message: "Identificador de lote inválido." }); next();
  }, large, handle((req, user) => batch.stage(user, id(req), batchChunkSchema.parse(req.body))));
  router.get("/batches/:id", authenticate, handle((req, user) => batch.get(user, id(req))));
  router.get("/batches/:id/rows", authenticate, handle((req, user) => { const { page, filter } = pageSchema.parse(req.query); return batch.rows(user, id(req), page, filter); }));
  router.post("/batches/:id/preview", authenticate, writes, small, handle((req, user) => batch.preview(user, id(req), batchRevisionSchema.parse(req.body).expectedRevision)));
  router.post("/batches/:id/apply", authenticate, writes, small, handle((req, user) => batch.apply(user, id(req), batchApplySchema.parse(req.body))));
  router.post("/batches/:id/cancel", authenticate, writes, small, handle((req, user) => { if (Object.keys(z.record(z.string(), z.unknown()).parse(req.body)).length) throw new z.ZodError([]); return batch.cancel(user, id(req)); }));
  router.patch("/items/:id", authenticate, small, handle((req, user) => editInventoryItem(user, id(req), inventoryEditSchema.parse(req.body))));
  router.put("/items/:id/commercial-terms", authenticate, small, handle((req, user) => setInventoryTerms(user, id(req), inventoryTermsSchema.parse(req.body))));
  router.get("/items/:id/commercial-terms", authenticate, handle((req, user) => prisma.$transaction(async tx => {
    await lockInventoryOwner(tx, user); const item = await tx.inventoryItem.findFirst({ where: { id: id(req), userId: user }, include: { commercialTerms: true } }); if (!item) throw new Error("NOT_FOUND"); return inventoryItemView(item);
  })));
  router.get("/export", authenticate, exports, async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.sendStatus(401);
    try {
      const options = exportSchema.parse(req.query);
      const result = await exportInventory(req.user.id, options.q, options.limit, options.cursor, options.segment === "true", options.format, options.template === "true");
      res.setHeader("Content-Type", options.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="inventario-${result.capturedAt.slice(0, 10)}.${options.format}"`);
      if (result.nextCursor) res.setHeader("X-Inventory-Next-Cursor", result.nextCursor);
      res.setHeader("X-Inventory-Captured-At", result.capturedAt); res.setHeader("X-Inventory-Row-Count", String(result.count)); return res.send(result.bytes);
    } catch (error) { return failure(error, res); }
  });
  router.get("/batches/:id/report", authenticate, async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.sendStatus(401);
    try {
      const reports = await batch.report(req.user.id, id(req));
      res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", 'attachment; filename="informe-inventario.csv"'); return res.send(inventoryReportCsv(reports));
    } catch (error) { return failure(error, res); }
  });
  return router;
}
