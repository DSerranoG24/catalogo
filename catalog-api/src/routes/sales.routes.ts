// @ts-nocheck
import express, { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { createSaleSchema, updateDraftSaleSchema, confirmSaleSchema, transitionSaleSchema, cancelSaleSchema, returnSaleSchema } from "../schemas/sales.schema";
import { makeSaleService } from "../services/sale.service";
export function makeSalesRouter() {
  const router = Router(), service = makeSaleService();
  const route = (work: (user: string, req: AuthenticatedRequest) => Promise<unknown>) => async (req: AuthenticatedRequest, res: any) => { if (!req.user) return res.sendStatus(401); try { return res.json({ result: await work(req.user.id, req) }); } catch (e) { const code = e instanceof Error ? e.message : "UNKNOWN"; const status = ["VERSION_CONFLICT", "INVALID_TRANSITION", "STOCK_INSUFFICIENT", "PRICE_CHANGED", "IDEMPOTENCY_CONFLICT", "RETURN_MUST_BE_TOTAL"].includes(code) ? 409 : code === "NOT_FOUND" ? 404 : 400; return res.status(status).json({ message: code }); } };
  router.get("/sales", authenticate, route(u => service.list(u)));
  router.get("/sales/:id", authenticate, route((u, r) => service.get(u, String(r.params.id))));
  router.post("/sales", authenticate, express.json({ limit: "32kb" }), route((u, r) => service.create(u, createSaleSchema.parse(r.body))));
  router.patch("/sales/:id", authenticate, express.json({ limit: "32kb" }), route((u, r) => service.updateDraft(u, String(r.params.id), updateDraftSaleSchema.parse(r.body))));
  router.post("/sales/:id/confirm", authenticate, express.json({ limit: "32kb" }), route((u, r) => service.confirm(u, String(r.params.id), confirmSaleSchema.parse(r.body))));
  router.post("/sales/:id/deliver", authenticate, express.json({ limit: "32kb" }), route((u, r) => service.transition(u, r.params.id, transitionSaleSchema.parse(r.body))));
  router.post("/sales/:id/cancel", authenticate, express.json({ limit: "32kb" }), route((u, r) => service.cancel(u, r.params.id, cancelSaleSchema.parse(r.body))));
  router.post("/sales/:id/returns", authenticate, express.json({ limit: "32kb" }), route((u, r) => service.returnSale(u, r.params.id, returnSaleSchema.parse(r.body))));
  return router;
}
