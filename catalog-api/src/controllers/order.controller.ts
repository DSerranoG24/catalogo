import { Response } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import { updateOrderSchema } from "../schemas/order.schema";
import { getOrdersForCatalog, updateOrderStatus } from "../services/order.service";

export async function getCatalogOrdersController(req: AuthenticatedRequest, res: Response) {
  try {
    const orders = await getOrdersForCatalog(req.params.catalogId as string, req.user!.id);
    return res.json({ success: true, orders });
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
