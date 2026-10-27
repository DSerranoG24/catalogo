import { Request, Response } from "express";
import { findPublicCatalog } from "../repositories/catalog.repository";
import { createPublicOrderSchema } from "../schemas/order.schema";
import { createPublicOrder } from "../services/order.service";
import { createProductImageSignedUrl } from "../services/storage.service";
import { getCurrentProductPricing } from "../services/product-pricing";
import { signCategoryImage } from "../services/category.service";
import { quotationBaseUrl, quotationLabel, quotationUrl } from "../services/quotation-data";
import { issueQuotation } from "../repositories/quotation-issue.repository";
import { logQuotationFailure, quotationErrorCode, quotationRequestId } from "../services/quotation-errors";

export function makePublicCatalogController(deps = { find: findPublicCatalog, sign: createProductImageSignedUrl, signCategory: signCategoryImage }) {
  return async (req: Request, res: Response) => {
  try {
    const catalog = await deps.find(req.params.publicId as string);
    if (!catalog) {
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }

    const now = new Date();
    const categories = await Promise.all(catalog.categories.map(deps.signCategory));
    const products = await Promise.all(catalog.products.map(async (product) => {
      const { salePrice, saleStartsAt, saleEndsAt, ...publicProduct } = product;
      return {
        ...publicProduct,
        ...getCurrentProductPricing({ price: product.price, salePrice, saleStartsAt, saleEndsAt }, now),
        images: await Promise.all(product.images.map(async (image) => ({
          ...image,
          url: await deps.sign(image.url),
        }))),
      };
    }));

    const featuredIds = new Set(catalog.featuredProducts.map(product => product.id));
    const banners = (await Promise.all(catalog.banners.map(async banner => {
      try { return { ...banner, imageUrl: await deps.sign(banner.imagePath) }; }
      catch { return null; }
    }))).filter(banner => banner !== null);
    return res.json({ success: true, catalog: { ...catalog, logoUrl: catalog.logoUrl ? await deps.sign(catalog.logoUrl) : null, categories, products, featuredProducts: products.filter(product => featuredIds.has(product.id)), banners } });
  } catch {
    return res.status(500).json({ success: false, message: "No se pudo cargar el catálogo" });
  }
  };
}
export const getPublicCatalogController = makePublicCatalogController();

export function makePublicOrderController(deps = {
  create: createPublicOrder, issue: issueQuotation, base: quotationBaseUrl, log: logQuotationFailure,
}) {
  return async (req: Request, res: Response) => {
    const parsed = createPublicOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: "Revisa los datos de la orden" });
    }

    let order: Awaited<ReturnType<typeof createPublicOrder>>;
    try {
      order = await deps.create(req.params.publicId as string, parsed.data);
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
    // The commit is complete. Quotation/configuration/formatting/log failures cannot undo the order.
    const requestId = quotationRequestId();
    let quotation: { quotationNumber: string | null; quotationUrl: string | null; quotationIssuedAt: Date | null } = {
      quotationNumber: null, quotationUrl: null, quotationIssuedAt: null,
    };
    try {
      const base = deps.base();
      const issued = await deps.issue(req.params.publicId as string, order.id);
      if (issued) quotation = {
        quotationNumber: quotationLabel(issued.quotationNumber),
        quotationUrl: quotationUrl(base, req.params.publicId as string, order.id, issued.quotationToken),
        quotationIssuedAt: issued.quotationIssuedAt,
      };
    } catch (error) {
      try { deps.log({ event: "quotation_issue_failed", requestId, errorCode: quotationErrorCode(error) }); }
      catch { /* A logging transport failure must not turn a committed purchase into an HTTP error. */ }
    }
    return res.set({ "Cache-Control": "private, no-store", "X-Request-ID": requestId }).status(201)
      .json({ success: true, requestId, order: { ...order, ...quotation } });
  };
}

export const createPublicOrderController = makePublicOrderController();
