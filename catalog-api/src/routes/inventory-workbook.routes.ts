import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { workbookSaveSchema } from "../schemas/inventory-workbook.schema";
import { makeInventoryWorkbookService } from "../services/inventory-workbook.service";
export function makeInventoryWorkbookRouter() {
  const router = Router(), service = makeInventoryWorkbookService();
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
  }); return router;
}
