import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { inventoryItemSchema, inventoryMovementSchema, inventoryPageSchema } from "../schemas/inventory.schema";
import * as inventory from "../repositories/inventory.repository";

export function makeInventoryRouter(repository = inventory, authentication = authenticate) {
const router = Router();
router.use(authentication);
for (const operation of ["list", "create", "history", "move"] as const) {
  const path = operation === "history" || operation === "move" ? "/items/:id/movements" : "/items";
  const method = operation === "create" || operation === "move" ? "post" : "get";
  router[method](path, async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Sesión requerida" });
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const userId = req.user.id;
      let result: unknown;
      if (operation === "list") {
        const { page, q } = inventoryPageSchema.parse(req.query);
        result = await repository.listInventory(userId, page, q);
      } else if (operation === "create") result = await repository.createInventory(userId, inventoryItemSchema.parse(req.body));
      else {
        const id = z.uuid().parse(req.params.id);
        result = operation === "move"
          ? await repository.moveInventory(userId, id, inventoryMovementSchema.parse(req.body))
          : await repository.inventoryHistory(userId, id, inventoryPageSchema.parse(req.query).page);
      }
      return res.json({ success: true, result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Revisa los campos y las cantidades ingresadas." });
      if (error instanceof Error && error.message === "NOT_FOUND") return res.status(404).json({ message: "Producto no encontrado." });
      if (error instanceof Error && error.message === "INVALID_STOCK") return res.status(409).json({ message: "El movimiento excede las existencias o el límite permitido." });
      if ((error instanceof Error && error.message === "KEY_CONFLICT") || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) return res.status(409).json({ message: "El SKU o identificador ya está en uso. Revisa el inventario antes de reintentar." });
      return res.status(500).json({ message: "No se pudo completar la operación de inventario. Puedes reintentar." });
    }
  });
}
return router;
}
export default makeInventoryRouter();
