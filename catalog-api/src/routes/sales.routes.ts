import express, { Router, type Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { createSaleSchema, updateDraftSaleSchema, confirmSaleSchema, deliverSaleSchema, cancelSaleSchema, returnSaleSchema, salePaymentsSchema, voidSalePaymentSchema, replaceSalePaymentSchema,
  saleCustomerLinkSchema, saleRefundSchema, creditRefundSchema, creditRefundVoidSchema } from "../schemas/sales.schema";
import { makeSaleService } from "../services/sale.service";
import { makeSaleMoneyService } from "../services/sale-money.service";

// Payment fields of the existing sale bodies; a Zod error on them answers INVALID_PAYMENT_INPUT instead of INVALID_SALE_INPUT.
const PAYMENT_FIELDS = new Set(["payments", "customerCreditAmount", "refundNow"]);
// Payment errors (F2a-2b, docs/sales-payments-cartera-contract.md section 8).
const PAYMENT_CONFLICTS = ["PAYMENT_EXCEEDS_BALANCE", "SALE_BALANCE_DUE", "LEGACY_SALE_PAYMENTS_UNSUPPORTED", "INVALID_PAYMENT_STATE", "CUSTOMER_REQUIRED_FOR_CREDIT", "CREDIT_INSUFFICIENT",
  "CREDIT_ALREADY_USED", "PAYMENT_ALREADY_REFUNDED", "PAYMENT_ALREADY_VOIDED", "PAYMENT_NOT_VOIDABLE", "REFUND_EXCEEDS_DUE", "REFUND_REQUIRES_NO_CUSTOMER", "CUSTOMER_CHANGE_BLOCKED"];

// Rules of F2a-3c, with their message for whoever calls the API directly.
const SPANISH: Record<string, [number, string]> = {
  VOID_REQUIRES_REPLACEMENT: [409, "En una venta entregada, anula el pago y registra el pago correcto (anular y reemplazar)."],
  REPLACEMENT_AMOUNT_MISMATCH: [409, "El pago que reemplaza debe ser por el mismo monto que el pago anulado."],
  PAYMENTS_REQUIRED: [400, "Indica cómo se pagó la venta: envía los pagos (un anticipo de 0 es payments: [])."],
};

export function makeSalesRouter(service = makeSaleService(), authentication = authenticate, money = makeSaleMoneyService()) {
  const router = Router();
  const route = (work: (user: string, req: AuthenticatedRequest) => Promise<unknown>, moneyRoute = false) => async (req: AuthenticatedRequest, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.sendStatus(401);
    try {
      for (const key of ["id", "entryId"]) if (req.params[key] !== undefined) z.uuid().parse(req.params[key]);
      const result = await work(req.user.id, req);
      return res.type("json").send(JSON.stringify({ result }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value));
    } catch (error) {
      if (error instanceof z.ZodError) {
        const payment = moneyRoute || error.issues.some(issue => PAYMENT_FIELDS.has(String(issue.path[0])));
        return payment ? res.status(400).json({ error: "INVALID_PAYMENT_INPUT", message: "Revisa los pagos." }) : res.status(400).json({ error: "INVALID_SALE_INPUT", message: "Revisa los datos de la venta." });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: "IDEMPOTENCY_CONFLICT", message: "IDEMPOTENCY_CONFLICT" });
      const code = error instanceof Error ? error.message : "UNKNOWN";
      if (code === "CUSTOMER_NOT_FOUND") return res.status(404).json({ error: code, message: "Cliente no encontrado." });
      if (code === "CUSTOMER_ARCHIVED") return res.status(409).json({ error: code, message: "El cliente está archivado. Selecciona otro cliente o crea la venta sin cliente." });
      if (code === "ACCOUNT_CLOSED") return res.status(401).json({ error: "AUTH_REQUIRED", message: "Tu sesión ya no está disponible." });
      if (["VERSION_CONFLICT", "INVALID_TRANSITION", "STOCK_INSUFFICIENT", "PRICE_CHANGED", "IDEMPOTENCY_CONFLICT", "RETURN_EXCEEDS_SOLD"].includes(code)) return res.status(409).json({ error: code, message: code });
      if (SPANISH[code]) return res.status(SPANISH[code][0]).json({ error: code, message: SPANISH[code][1] });
      if (PAYMENT_CONFLICTS.includes(code)) return res.status(409).json({ error: code, message: code });
      if (code === "REFUND_NOW_REQUIRES_NO_CUSTOMER") return res.status(400).json({ error: "INVALID_PAYMENT_INPUT", message: "«Devolver ahora» solo aplica a ventas sin cliente; con cliente el dinero queda como saldo a favor." });
      if (["NOT_FOUND", "PAYMENT_NOT_FOUND", "CREDIT_ENTRY_NOT_FOUND"].includes(code)) return res.status(404).json({ error: code, message: code });
      if (["ITEM_NOT_FOUND", "PRICE_REQUIRED", "INVALID_DISCOUNT", "RETURN_LINE_DUPLICATE", "RETURN_LINE_NOT_FOUND"].includes(code)) return res.status(400).json({ error: code, message: code });
      return res.status(500).json({ error: "SALE_OPERATION_FAILED", message: "No se pudo completar la operación de venta." });
    }
  };
  router.get("/sales", authentication, route(u => service.list(u)));
  router.get("/sales/:id", authentication, route((u, r) => service.get(u, String(r.params.id))));
  router.post("/sales", authentication, express.json({ limit: "32kb" }), route((u, r) => service.create(u, createSaleSchema.parse(r.body))));
  router.patch("/sales/:id", authentication, express.json({ limit: "32kb" }), route((u, r) => service.updateDraft(u, String(r.params.id), updateDraftSaleSchema.parse(r.body))));
  router.post("/sales/:id/confirm", authentication, express.json({ limit: "32kb" }), route((u, r) => service.confirm(u, String(r.params.id), confirmSaleSchema.parse(r.body))));
  router.post("/sales/:id/deliver", authentication, express.json({ limit: "32kb" }), route((u, r) => service.transition(u, String(r.params.id), deliverSaleSchema.parse(r.body))));
  router.post("/sales/:id/cancel", authentication, express.json({ limit: "32kb" }), route((u, r) => service.cancel(u, String(r.params.id), cancelSaleSchema.parse(r.body))));
  router.post("/sales/:id/returns", authentication, express.json({ limit: "32kb" }), route((u, r) => service.returnSale(u, String(r.params.id), returnSaleSchema.parse(r.body))));
  // Money operations (F2a-2b): { result: { result, idempotent } }.
  const body = express.json({ limit: "32kb" });
  router.post("/sales/:id/payments", authentication, body, route((u, r) => money.advance(u, String(r.params.id), salePaymentsSchema.parse(r.body)), true));
  router.post("/sales/:id/payments/:entryId/void", authentication, body, route((u, r) => money.voidPayment(u, String(r.params.id), String(r.params.entryId), voidSalePaymentSchema.parse(r.body)), true));
  router.post("/sales/:id/payments/:entryId/replace", authentication, body, route((u, r) => money.replacePayment(u, String(r.params.id), String(r.params.entryId), replaceSalePaymentSchema.parse(r.body)), true));
  router.post("/sales/:id/customer", authentication, body, route((u, r) => money.linkCustomer(u, String(r.params.id), saleCustomerLinkSchema.parse(r.body)), true));
  router.post("/sales/:id/refunds", authentication, body, route((u, r) => money.refundSale(u, String(r.params.id), saleRefundSchema.parse(r.body)), true));
  router.get("/customers/:id/credit", authentication, route((u, r) => money.customerCredit(u, String(r.params.id)), true));
  router.post("/customers/:id/credit/refunds", authentication, body, route((u, r) => money.refundCredit(u, String(r.params.id), creditRefundSchema.parse(r.body)), true));
  router.post("/customers/:id/credit/refunds/:entryId/void", authentication, body, route((u, r) => money.voidCreditRefund(u, String(r.params.id), String(r.params.entryId), creditRefundVoidSchema.parse(r.body)), true));
  return router;
}
