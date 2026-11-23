import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import type { CustomerSalesQuery } from "../schemas/customer-sales.schema";

export const CUSTOMER_SALES_PAGE_SIZE = 25;
const saleSelection = {
  id: true, status: true, version: true, currency: true, total: true, createdAt: true,
  sourceOrderId: true, customerNameSnapshot: true, customerName: true,
} satisfies Prisma.SaleSelect;

export function makeCustomerSalesRepository(database = prisma) {
  return {
    async list(ownerId: string, customerId: string, query: CustomerSalesQuery) {
      return database.$transaction(async tx => {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, ownerId }, select: { id: true, fullName: true, archivedAt: true },
        });
        if (!customer) return null;
        const scope: Prisma.SaleWhereInput = {
          userId: ownerId, customerId, ...(query.status === "all" ? {} : { status: query.status }),
        };
        const cursor = query.cursor ? await tx.sale.findFirst({
          where: { ...scope, id: query.cursor }, select: { id: true, createdAt: true },
        }) : null;
        if (query.cursor && !cursor) return null;
        // Keyset bounds remain stable even if a cursor row disappears after this read.
        const rows = await tx.sale.findMany({
          where: { ...scope, ...(cursor ? { OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ] } : {}) },
          select: saleSelection, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: CUSTOMER_SALES_PAGE_SIZE + 1,
        });
        const sales = rows.slice(0, CUSTOMER_SALES_PAGE_SIZE).map(sale => ({ ...sale, total: sale.total.toString() }));
        return { customer, sales, nextCursor: rows.length > CUSTOMER_SALES_PAGE_SIZE ? sales.at(-1)?.id ?? null : null };
      });
    },
  };
}
