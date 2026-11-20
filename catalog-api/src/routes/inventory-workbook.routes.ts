import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { workbookSaveSchema } from "../schemas/inventory-workbook.schema";
import { workbookPreviewApplySchema, workbookPreviewSchema } from "../schemas/inventory-workbook-preview.schema";
import { makeInventoryWorkbookService } from "../services/inventory-workbook.service";
import { makeInventoryWorkbookPreviewService } from "../services/inventory-workbook-preview.service";
import { makeInventoryBatchService } from "../services/inventory-batch.service";
import { createHash } from "node:crypto";
export function makeInventoryWorkbookRouter() {
  const router = Router(), service = makeInventoryWorkbookService(), previewService = makeInventoryWorkbookPreviewService(), batchService = makeInventoryBatchService();
  const writes = rateLimit({ windowMs: 15 * 60_000, limit: 30, legacyHeaders: false, standardHeaders: "draft-8", keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated" });
  router.get("/workbook", authenticate, async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.sendStatus(401);
    try { return res.json({ result: await service.get(req.user.id) }); } catch { return res.status(503).json({ message: "No se pudo cargar la hoja. Reintenta antes de editar." }); }
  });
  router.put("/workbook", authenticate, writes, express.json({ limit: "4mb" }), async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.sendStatus(401);
    try { return res.json({ result: await service.save(req.user.id, workbookSaveSchema.parse(req.body)) }); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Revisa el documento: máximo 10 pestañas, 10.000 filas, 200 columnas, 50.000 celdas y 2 MiB de contenido." });
      const code = error instanceof Error ? error.message : "UNKNOWN";
      if (code === "ACCOUNT_CLOSED") return res.status(401).json({ message: "Tu cuenta ya no permite guardar. Inicia sesión para continuar." });
      if (["VERSION_CONFLICT", "KEY_CONFLICT"].includes(code)) return res.status(409).json({ message: "La hoja cambió en otra sesión o la operación tiene otro contenido. Descarga tu copia antes de recargar; no se sobrescribió la versión guardada." });
      return res.status(503).json({ message: "No se pudo confirmar el guardado. Reintenta Guardar con la misma hoja." });
    }
  });
  router.post("/workbook/preview", authenticate, express.json({ limit: "32kb" }), async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.sendStatus(401);
    try { return res.json({ result: await previewService.preview(req.user.id, workbookPreviewSchema.parse(req.body)) }); }
    catch (cause) {
      if (cause instanceof z.ZodError) return res.status(400).json({ message: "Revisa el rango y la asignación confirmada de columnas." });
      const code = cause instanceof Error ? cause.message : "UNKNOWN";
      if (code === "ACCOUNT_CLOSED") return res.status(401).json({ message: "Tu cuenta está cerrada." });
      if (code === "VERSION_CONFLICT") return res.status(409).json({ message: "La hoja cambió; vuelve a preparar la vista previa." });
      if (["WORKBOOK_NOT_FOUND", "SHEET_NOT_FOUND"].includes(code)) return res.status(404).json({ message: "No se encontró la hoja solicitada." });
      if (["RANGE_OUT_OF_BOUNDS", "MAPPING_OUT_OF_BOUNDS", "INVALID_HEADERS", "INVALID_SNAPSHOT"].includes(code)) return res.status(400).json({ message: "El rango o la hoja no son válidos." });
      return res.status(503).json({ message: "No se pudo interpretar la hoja. Reintenta." });
    }
  });
  router.post("/workbook/preview/apply", authenticate, writes, express.json({ limit: "32kb" }), async (req: AuthenticatedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store"); if (!req.user) return res.sendStatus(401);
    try {
      const input = workbookPreviewApplySchema.parse(req.body);
      const interpreted = await previewService.preview(req.user.id, input);
      if (!interpreted.rows.length || interpreted.rows.some(row => row.classification === "ERROR" || row.classification === "EMPTY")) throw new Error("BATCH_NOT_READY");
      const rows = interpreted.rows.map(row => { const { quantity, ...values } = row.values; return { rowId: deterministicRowId(input.batchId, row.rowNumber), rowNumber: row.rowNumber, excluded: false, values: quantity === undefined ? values : { ...values, targetStock: Number(quantity) } }; });
      const created = await batchService.create(req.user.id, { id: input.batchId, source: "GRID", totalRows: rows.length, reason: input.reason });
      const staged = await batchService.stage(req.user.id, input.batchId, { chunkId: input.operationId, expectedRevision: created.revision, totalRows: rows.length, rows });
      const planned = await batchService.preview(req.user.id, input.batchId, staged.revision);
      if (planned.status !== "READY" || !planned.planHash || !planned.applyOperationId) throw new Error("BATCH_NOT_READY");
      return res.json({ result: await batchService.apply(req.user.id, input.batchId, { expectedRevision: planned.revision, previewRevision: planned.previewRevision, planHash: planned.planHash, operationId: planned.applyOperationId }) });
    } catch (cause) {
      if (cause instanceof z.ZodError) return res.status(400).json({ message: "Revisa la confirmación y el rango seleccionado." });
      const code = cause instanceof Error ? cause.message : "UNKNOWN";
      if (code === "BATCH_NOT_READY") return res.status(409).json({ message: "La vista previa contiene filas bloqueadas o cantidades sin política explícita. No se aplicó ninguna fila." });
      if (["VERSION_CONFLICT", "STALE_BATCH", "KEY_CONFLICT"].includes(code)) return res.status(409).json({ message: "Los datos cambiaron o la operación ya fue intentada. Vuelve a previsualizar." });
      if (code === "ACCOUNT_CLOSED") return res.status(401).json({ message: "Tu cuenta está cerrada." });
      return res.status(503).json({ message: "No se pudo aplicar el lote. Consulta el mismo lote antes de reintentar." });
    }
  }); return router;
}

function deterministicRowId(batchId: string, rowNumber: number) {
  const bytes = createHash("sha256").update(`${batchId}:${rowNumber}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
