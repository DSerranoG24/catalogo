import { Request, Response } from "express";
import { z } from "zod";
import { findQuotation, quotationStillAccessible } from "../repositories/quotation.repository";
import { quotationLabel, quotationSellerSchema } from "../services/quotation-data";
import { loadCurrentQuotationLogo } from "../services/quotation-logo";
import { generateQuotationPdf } from "../services/quotation-pdf";

export const quotationPrivacyHeaders = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const accessSchema = z.object({ publicId: z.string().uuid(), orderId: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) });

export function createQuotationController(deps = {
  find: findQuotation, stillAccessible: quotationStillAccessible,
  logo: loadCurrentQuotationLogo, pdf: generateQuotationPdf,
}) {
  let generating = 0;
  return async (req: Request, res: Response) => {
    res.set(quotationPrivacyHeaders);
    const parsed = accessSchema.safeParse({ ...req.params, token: req.query.token });
    if (!parsed.success) return res.status(404).json({ success: false, message: "Cotización no disponible" });
    if (generating >= 2) return res.set("Retry-After", "10").status(503).json({ success: false, message: "Intenta descargar de nuevo en unos segundos" });
    generating++;
    try {
      const { publicId, orderId, token } = parsed.data;
      const order = await deps.find(publicId, orderId, token);
      if (!order || order.quotationNumber === null || !order.quotationIssuedAt || !order.quotationSellerSnapshot) {
        return res.status(404).json({ success: false, message: "Cotización no disponible" });
      }
      const seller = quotationSellerSchema.parse(order.quotationSellerSnapshot);
      const logo = await deps.logo(order.catalogId, order.catalog.logoUrl);
      const bytes = await deps.pdf({ number: order.quotationNumber, issuedAt: order.quotationIssuedAt,
        seller, customerName: order.customerName, customerPhone: order.customerPhone,
        customerAddress: order.customerAddress, total: order.total, items: order.items }, logo);
      // Recheck after rendering: cancellation or anonymization revokes this download.
      if (!await deps.stillAccessible(publicId, orderId, token)) return res.status(404).json({ success: false, message: "Cotización no disponible" });
      return res.type("application/pdf").set("Content-Disposition", `inline; filename="${quotationLabel(order.quotationNumber)}.pdf"`).send(bytes);
    } catch {
      return res.status(503).json({ success: false, message: "No se pudo generar la cotización. Intenta de nuevo" });
    } finally { generating--; }
  };
}

export const getQuotationController = createQuotationController();
