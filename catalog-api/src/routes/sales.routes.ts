import express, { Router, type Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { createSaleSchema, updateDraftSaleSchema, confirmSaleSchema, transitionSaleSchema, cancelSaleSchema, returnSaleSchema } from "../schemas/sales.schema";
import { makeSaleService } from "../services/sale.service";
export function makeSalesRouter(service = makeSaleService(), authentication = authenticate) {
  const router = Router();
  const route = (work: (user: string, req: AuthenticatedRequest) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.sendStatus(401);
    try {
      if (req.params.id !== undefined) z.uuid().parse(req.params.id);
      const result = await work(req.user.id, req);
      return res.type("json").send(JSON.stringify({ result }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "INVALID_SALE_INPUT", message: "Revisa los datos de la venta." });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: "IDEMPOTENCY_CONFLICT", message: "IDEMPOTENCY_CONFLICT" });
      const code = error instanceof Error ? error.message : "UNKNOWN";
      if (code === "CUSTOMER_NOT_FOUND") return res.status(404).json({ error: code, message: "Cliente no encontrado." });
      if (code === "CUSTOMER_ARCHIVED") return res.status(409).json({ error: code, message: "El cliente está archivado. Selecciona otro cliente o crea la venta sin cliente." });
      if (code === "ACCOUNT_CLOSED") return res.status(401).json({ error: "AUTH_REQUIRED", message: "Tu sesión ya no está disponible." });
      if (["VERSION_CONFLICT", "INVALID_TRANSITION", "STOCK_INSUFFICIENT", "PRICE_CHANGED", "IDEMPOTENCY_CONFLICT", "RETURN_EXCEEDS_SOLD"].includes(code)) return res.status(409).json({ error: code, message: code });
      if (code === "NOT_FOUND") return res.status(404).json({ error: code, message: code });
      if (["ITEM_NOT_FOUND", "PRICE_REQUIRED", "INVALID_DISCOUNT", "RETURN_LINE_DUPLICATE", "RETURN_LINE_NOT_FOUND"].includes(code)) return res.status(400).json({ error: code, message: code });
      return res.status(500).json({ error: "SALE_OPERATION_FAILED", message: "No se pudo completar la operación de venta." });
    }
  };
  router.get("/sales", authentication, route(u => service.list(u)));
  router.get("/sales/:id", authentication, route((u, r) => service.get(u, String(r.params.id))));
  router.post("/sales", authentication, express.json({ limit: "32kb" }), route((u, r) => service.create(u, createSaleSchema.parse(r.body))));
  router.patch("/sales/:id", authentication, express.json({ limit: "32kb" }), route((u, r) => service.updateDraft(u, String(r.params.id), updateDraftSaleSchema.parse(r.body))));
  router.post("/sales/:id/confirm", authentication, express.json({ limit: "32kb" }), route((u, r) => service.confirm(u, String(r.params.id), confirmSaleSchema.parse(r.body))));
  router.post("/sales/:id/deliver", authentication, express.json({ limit: "32kb" }), route((u, r) => service.transition(u, String(r.params.id), transitionSaleSchema.parse(r.body))));
  router.post("/sales/:id/cancel", authentication, express.json({ limit: "32kb" }), route((u, r) => service.cancel(u, String(r.params.id), cancelSaleSchema.parse(r.body))));
  router.post("/sales/:id/returns", authentication, express.json({ limit: "32kb" }), route((u, r) => service.returnSale(u, String(r.params.id), returnSaleSchema.parse(r.body))));
  return router;
}
