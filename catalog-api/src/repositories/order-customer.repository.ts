import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockOwnedOrder } from "./order-privacy.repository";
import { lockInventoryOwner } from "./inventory.repository";
import { customerPhoneSchema } from "../schemas/customer.schema";
import type { ConfirmOrderCustomer } from "../schemas/order-customer.schema";

const sourceSelect = {
  id: true, customerId: true, status: true, anonymizedAt: true, customerName: true, customerPhone: true,
  customerEmail: true, customerAddress: true, notes: true,
} satisfies Prisma.OrderSelect;
const matchingSelect = { id: true, fullName: true, phone: true, email: true } satisfies Prisma.CustomerSelect;
type Match = Prisma.CustomerGetPayload<{ select: typeof matchingSelect }>;
export class OrderCustomerConflict extends Error {
  constructor(readonly code: string, readonly matches: Match[] = [], readonly hasMore = false) { super(code); }
}
function assertAvailable(order: { status: string; anonymizedAt: Date | null } | null) {
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status === "CANCELLED") throw new OrderCustomerConflict("ORDER_CANCELLED");
  if (order.anonymizedAt) throw new OrderCustomerConflict("ORDER_ANONYMIZED");
}
async function matches(tx: Pick<Prisma.TransactionClient, "customer">, ownerId: string, phone: string, page = 1) {
  const rows = await tx.customer.findMany({ where: { ownerId, phone, archivedAt: null }, select: matchingSelect, orderBy: { id: "asc" }, skip: (page - 1) * 25, take: 26 });
  return { matches: rows.slice(0, 25), hasMore: rows.length > 25 };
}
export function makeOrderCustomerRepository(database = prisma) {
  return {
    async matchingPage(ownerId: string, orderId: string, phone: string, page: number) {
      const order = await database.order.findFirst({ where: { id: orderId, catalog: { userId: ownerId } }, select: sourceSelect });
      assertAvailable(order);
      return { ...await matches(database, ownerId, phone, page), page };
    },
    async preview(ownerId: string, orderId: string) {
      const order = await database.order.findFirst({ where: { id: orderId, catalog: { userId: ownerId } }, select: sourceSelect });
      assertAvailable(order);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      const phone = customerPhoneSchema.safeParse(order.customerPhone);
      const found = phone.success ? await matches(database, ownerId, phone.data) : { matches: [], hasMore: false };
      const sale = await database.sale.findFirst({ where: { sourceOrderId: orderId, userId: ownerId }, select: { id: true, customerId: true } });
      const existingCustomer = order.customerId ? await database.customer.findFirst({ where: { id: order.customerId, ownerId }, select: { ...matchingSelect, archivedAt: true } }) : null;
      return {
        fields: { fullName: order.customerName, phone: order.customerPhone, email: order.customerEmail, address: order.customerAddress, notes: order.notes },
        customerId: order.customerId, existingCustomer, sale, ...found,
      };
    },
    async confirm(ownerId: string, orderId: string, input: ConfirmOrderCustomer) {
      const requestHash = createHash("sha256").update(JSON.stringify({ orderId, input })).digest("hex");
      return database.$transaction(async tx => {
        await lockOwnedOrder(tx, orderId, ownerId);
        await lockInventoryOwner(tx, ownerId);
        const order = await tx.order.findFirst({ where: { id: orderId, catalog: { userId: ownerId } }, select: sourceSelect });
        assertAvailable(order);
        if (!order) throw new Error("ORDER_NOT_FOUND");
        // Same key on different orders must serialize before either command writes.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"order-customer-v1:" + ownerId}), hashtext(${input.operationId}))`;
        const previous = await tx.orderCustomerOperation.findUnique({ where: { ownerId_operationId: { ownerId, operationId: input.operationId } } });
        if (previous) {
          if (previous.orderId !== orderId || previous.requestHash !== requestHash) throw new OrderCustomerConflict("IDEMPOTENCY_CONFLICT");
          const customer = await tx.customer.findFirstOrThrow({ where: { id: previous.customerId, ownerId } });
          return { customer, orderId, associatedSaleId: previous.associatedSaleId, idempotent: true };
        }
        const phone = input.action === "CREATE" ? input.customer.phone : input.phone;
        // Shared with ordinary customer creation/update: do not race an active phone match.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"customer-phone-v1:" + ownerId}), hashtext(${phone}))`;
        let customer;
        if (input.action === "CREATE") {
          if (order.customerId) throw new OrderCustomerConflict("ORDER_CUSTOMER_ALREADY_SAVED");
          const found = await matches(tx, ownerId, phone);
          if (found.matches.length) throw new OrderCustomerConflict("CUSTOMER_PHONE_MATCH", found.matches, found.hasMore);
          const fields = input.customer;
          customer = await tx.customer.create({ data: { ownerId, fullName: fields.fullName, phone: fields.phone, email: fields.email, address: fields.address, notes: fields.notes } });
        } else {
          await tx.$queryRaw`SELECT id FROM customers WHERE id = ${input.customerId} AND "ownerId" = ${ownerId} FOR SHARE`;
          customer = await tx.customer.findFirst({ where: { id: input.customerId, ownerId } });
          if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
          if (customer.archivedAt) throw new OrderCustomerConflict("CUSTOMER_ARCHIVED");
          if (customer.phone !== phone) throw new OrderCustomerConflict("CUSTOMER_MATCH_CHANGED");
          if (order.customerId && order.customerId !== customer.id) throw new OrderCustomerConflict("ORDER_CUSTOMER_CONFLICT");
        }
        let associatedSaleId: string | null = null;
        if (input.associateSale) {
          await tx.$queryRaw`SELECT id FROM "Sale" WHERE "sourceOrderId" = ${orderId} AND "userId" = ${ownerId} FOR UPDATE`;
          const sale = await tx.sale.findFirst({ where: { sourceOrderId: orderId, userId: ownerId }, select: { id: true, customerId: true } });
          if (!sale) throw new OrderCustomerConflict("ORDER_SALE_NOT_FOUND");
          if (sale.customerId && sale.customerId !== customer.id) throw new OrderCustomerConflict("SALE_CUSTOMER_CONFLICT");
          if (!sale.customerId) await tx.sale.update({ where: { id: sale.id, userId: ownerId }, data: { customerId: customer.id, version: { increment: 1 } } });
          associatedSaleId = sale.id;
        }
        await tx.order.update({ where: { id: orderId, catalog: { userId: ownerId } }, data: { customerId: customer.id } });
        await tx.orderCustomerOperation.create({ data: { ownerId, operationId: input.operationId, orderId, customerId: customer.id, associatedSaleId, requestHash } });
        return { customer, orderId, associatedSaleId, idempotent: false };
      });
    },
  };
}
