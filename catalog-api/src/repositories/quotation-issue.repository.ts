import { randomBytes } from "node:crypto";
import { prisma } from "../config/prisma";
import { quotationSellerSchema } from "../services/quotation-data";

export type IssuedQuotation = {
  quotationNumber: number;
  quotationToken: string;
  quotationIssuedAt: Date;
};

export async function issueQuotation(publicId: string, orderId: string, database = prisma): Promise<IssuedQuotation | null> {
  return database.$transaction(async transaction => {
    await transaction.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    await transaction.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
    // Lock the order BEFORE the catalog counter. Concurrent retries see the committed emission.
    const locked = await transaction.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM orders o
      JOIN catalogs c ON c.id = o."catalogId"
      WHERE o.id = ${orderId} AND c."publicId" = ${publicId}
      FOR UPDATE OF o
    `;
    if (locked.length !== 1) return null;
    const order = await transaction.order.findFirstOrThrow({
      where: { id: orderId, catalog: { publicId } },
      select: { id: true, catalogId: true, status: true, quotationNumber: true,
        quotationToken: true, quotationIssuedAt: true, quotationSellerSnapshot: true, anonymizedAt: true },
    });
    if (order.status === "CANCELLED" || order.anonymizedAt) return null;
    if (order.quotationNumber !== null && order.quotationToken !== null && order.quotationIssuedAt !== null && order.quotationSellerSnapshot !== null) {
      quotationSellerSchema.parse(order.quotationSellerSnapshot);
      return { quotationNumber: order.quotationNumber, quotationToken: order.quotationToken, quotationIssuedAt: order.quotationIssuedAt };
    }
    // Do not overwrite or renumber inconsistent historical data.
    if (order.quotationNumber !== null || order.quotationToken !== null || order.quotationIssuedAt !== null || order.quotationSellerSnapshot !== null) {
      throw new Error("INCOMPLETE_QUOTATION");
    }
    const seller = await transaction.catalog.update({
      where: { id: order.catalogId }, data: { quotationCounter: { increment: 1 } },
      select: { quotationCounter: true, name: true, nit: true, phone: true, whatsappPhone: true,
        address: true, businessHours: true, email: true, instagramUrl: true,
        facebookUrl: true, tiktokUrl: true, quotationTerms: true },
    });
    const quotationSellerSnapshot = quotationSellerSchema.parse(seller);
    const issued = { quotationNumber: seller.quotationCounter, quotationToken: randomBytes(32).toString("hex"), quotationIssuedAt: new Date() };
    const updated = await transaction.order.updateMany({
      where: { id: order.id, catalogId: order.catalogId, anonymizedAt: null, status: { not: "CANCELLED" },
        quotationNumber: null, quotationToken: null, quotationIssuedAt: null },
      data: { ...issued, quotationSellerSnapshot },
    });
    if (updated.count !== 1) throw new Error("QUOTATION_WRITE_CONFLICT");
    return issued;
  }, { maxWait: 1000, timeout: 3000 });
}
