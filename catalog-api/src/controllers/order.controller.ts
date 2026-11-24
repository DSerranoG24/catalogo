import { Response } from "express";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest } from "../types/auth.types";
import { updateOrderSchema } from "../schemas/order.schema";
import { getOrdersForCatalog, updateOrderStatus } from "../services/order.service";
import { z } from "zod";
import { convertOrderToSaleSchema } from "../schemas/sales.schema";
import { makeSaleService } from "../services/sale.service";
const saleService = makeSaleService();

export async function convertOrderToSaleController(req: AuthenticatedRequest, res: Response) {
  const parsed = convertOrderToSaleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Datos de conversión inválidos" });
  if (!req.user) return res.status(401).json({ success: false, message: "Sesión requerida" });
  try { const result = await saleService.convertOrderToSale(req.user.id, req.params.orderId as string, parsed.data); const sale = JSON.parse(JSON.stringify(result.sale, (_key, value) => typeof value === "bigint" ? value.toString() : value)); return res.json({ success: true, sale, idempotent: result.idempotent }); }
  catch (error) {
    // A requestId reused by another operation hits UNIQUE (userId, requestId): same answer as /sales.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && String(error.meta?.target ?? "").includes("requestId")) return res.status(409).json({ success: false, error: "IDEMPOTENCY_CONFLICT", message: "IDEMPOTENCY_CONFLICT" });
    const code = error instanceof Error ? error.message : "CONVERSION_FAILED";
    if (["ORDER_NOT_FOUND", "CUSTOMER_NOT_FOUND"].includes(code)) return res.status(404).json({ success: false, error: code, message: code });
    if (["IDEMPOTENCY_CONFLICT", "STOCK_INSUFFICIENT", "PRICE_DIFFERENCE_REQUIRES_CONFIRMATION", "ORDER_STATUS_NOT_CONVERTIBLE", "ORDER_ALREADY_CONVERTED", "CUSTOMER_ARCHIVED"].includes(code)) return res.status(409).json({ success: false, error: code, message: code });
    if (code === "ORDER_BUYER_PHONE_TOO_LONG") return res.status(409).json({ success: false, error: code, message: "El teléfono del pedido supera la capacidad del snapshot de la venta. No se creó la venta ni se recortó el teléfono." });
    if (["ORDER_ITEM_NOT_INVENTORY", "PRICE_REQUIRED"].includes(code)) return res.status(400).json({ success: false, error: code, message: code });
    if (code === "ACCOUNT_CLOSED") return res.status(401).json({ success: false, message: "Sesión no disponible" });
    return res.status(500).json({ success: false, error: "CONVERSION_FAILED", message: "No se pudo convertir el pedido." });
  }
}

export async function getCatalogOrdersController(req: AuthenticatedRequest, res: Response) {
  const cursor = z.string().uuid().optional().safeParse(req.query.cursor);
  if (!cursor.success) return res.status(400).json({ success: false, message: "Página de pedidos inválida." });
  try {
    const orders = await getOrdersForCatalog(req.params.catalogId as string, req.user!.id, cursor.data);
    const safeOrders = JSON.parse(JSON.stringify(orders, (_key, value) => typeof value === "bigint" ? value.toString() : value));
    return res.json({ success: true, orders: safeOrders, nextCursor: orders.length === 100 ? orders.at(-1)?.id : null });
  } catch {
    return res.status(500).json({ success: false, message: "No se pudieron obtener las órdenes" });
  }
}

export async function updateOrderController(req: AuthenticatedRequest, res: Response) {
  const parsed = updateOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Estado de orden inválido" });

  try {
    await updateOrderStatus(req.params.orderId as string, req.user!.id, parsed.data.status);
    return res.json({ success: true, message: "Estado actualizado" });
  } catch (error) {
    if (error instanceof Error && error.message === "ORDER_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Orden no encontrada" });
    }
    if (error instanceof Error && error.message === "INVALID_ORDER_TRANSITION") {
      return res.status(409).json({ success: false, message: "No se permite ese cambio de estado" });
    }
    return res.status(409).json({ success: false, message: "La orden cambió; vuelve a cargarla" });
  }
}
