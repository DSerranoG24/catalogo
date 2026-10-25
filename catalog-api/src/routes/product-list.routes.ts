import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/auth.types";
import type { ProductListingService } from "../services/product-list.service";
import { productCatalogParams, productListQuery, productSuggestionQuery } from "../schemas/product-list.schema";

// Mounted after authentication on the product router; the legacy GET is unchanged.
export function makeProductListingRouter(service: ProductListingService) {
  const router = Router({ mergeParams: true });
  for (const kind of ["list", "suggestions"] as const) router.get(`/${kind}`, async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Sesión requerida" });
    try {
      const { catalogId } = productCatalogParams.parse(req.params);
      const result = kind === "list"
        ? await service.list(catalogId, req.user.id, productListQuery.parse(req.query))
        : await service.suggest(catalogId, req.user.id, productSuggestionQuery.parse(req.query).q);
      if (!result) return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
      res.setHeader("Cache-Control", "private, no-store");
      return res.json({ success: true, ...(kind === "suggestions" ? { products: result } : result) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: "Parámetros de búsqueda o paginación no válidos" });
      return res.status(500).json({ success: false, message: "No se pudieron consultar los productos. Inténtalo de nuevo." });
    }
  });
  return router;
}
