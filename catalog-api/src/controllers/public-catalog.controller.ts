import { Request, Response } from "express";
import { findPublicCatalog } from "../repositories/catalog.repository";
import { createPublicOrderSchema } from "../schemas/order.schema";
import { createPublicOrder } from "../services/order.service";
import { createProductImageSignedUrl } from "../services/storage.service";
import { getCurrentProductPricing } from "../services/product-pricing";
import { signCategoryImage } from "../services/category.service";

export async function getPublicCatalogController(req: Request, res: Response) {
  try {
    const catalog = await findPublicCatalog(req.params.publicId as string);
    if (!catalog) {
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }

    const now = new Date();
    const categories = await Promise.all(catalog.categories.map(signCategoryImage));
    const products = await Promise.all(catalog.products.map(async (product) => {
      const { salePrice, saleStartsAt, saleEndsAt, ...publicProduct } = product;
      return {
        ...publicProduct,
        ...getCurrentProductPricing({ price: product.price, salePrice, saleStartsAt, saleEndsAt }, now),
        images: await Promise.all(product.images.map(async (image) => ({
          ...image,
          url: await createProductImageSignedUrl(image.url),
        }))),
      };
    }));

    return res.json({ success: true, catalog: { ...catalog, categories, products } });
  } catch {
    return res.status(500).json({ success: false, message: "No se pudo cargar el catálogo" });
  }
}

export async function createPublicOrderController(req: Request, res: Response) {
  const parsed = createPublicOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Revisa los datos de la orden" });
  }

  try {
    const order = await createPublicOrder(req.params.publicId as string, parsed.data);
    return res.status(201).json({ success: true, order });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }
    if (error instanceof Error && error.message === "PRODUCTS_UNAVAILABLE") {
      return res.status(409).json({ success: false, message: "Uno o más productos ya no están disponibles" });
    }
    if (error instanceof Error && error.message === "ORDER_TOTAL_INVALID") {
      return res.status(400).json({ success: false, message: "El importe de la orden supera el límite permitido" });
    }
    return res.status(500).json({ success: false, message: "No se pudo guardar la orden" });
  }
}
