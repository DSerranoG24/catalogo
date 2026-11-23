import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/auth.types";
import { customerIdSchema } from "../schemas/customer.schema";
import { customerSalesQuerySchema } from "../schemas/customer-sales.schema";
import { makeCustomerSalesService } from "../services/customer-sales.service";

export function makeCustomerSalesController(service = makeCustomerSalesService()) {
  return async (req: AuthenticatedRequest, res: Response) => {
    if (!req.user) return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión requerida." });
    try {
      const result = await service.list(req.user.id, customerIdSchema.parse(req.params.id), customerSalesQuerySchema.parse(req.query));
      return res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "INVALID_CUSTOMER_SALES_QUERY", message: "Revisa el cliente, estado y cursor de la consulta." });
      if (error instanceof Error && error.message === "CUSTOMER_SALES_NOT_FOUND") return res.status(404).json({ success: false, error: "CUSTOMER_SALES_NOT_FOUND", message: "Cliente o página de ventas no disponible." });
      return res.status(500).json({ success: false, error: "CUSTOMER_SALES_FAILED", message: "No se pudieron consultar las ventas. Puedes reintentar." });
    }
  };
}
