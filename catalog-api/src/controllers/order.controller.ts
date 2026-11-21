import { Response } from "express";
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
  try { const result = await saleService.convertOrderToSale(req.user!.id, req.params.orderId as string, parsed.data); const sale = JSON.parse(JSON.stringify(result.sale, (_key, value) => typeof value === "bigint" ? value.toString() : value)); return res.json({ success: true, sale, idempotent: result.idempotent }); }
  catch (error) { const code = error instanceof Error ? error.message : "CONVERSION_FAILED"; const status = ["ORDER_NOT_FOUND"].includes(code) ? 404 : ["IDEMPOTENCY_CONFLICT", "STOCK_INSUFFICIENT", "PRICE_DIFFERENCE_REQUIRES_CONFIRMATION", "ORDER_STATUS_NOT_CONVERTIBLE"].includes(code) ? 409 : 400; return res.status(status).json({ success: false, message: code }); }
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
