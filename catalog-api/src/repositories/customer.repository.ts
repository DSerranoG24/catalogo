import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import type { CreateCustomerInput, UpdateCustomerInput, CustomerListQuery } from "../schemas/customer.schema";

export const CUSTOMER_PAGE_SIZE = 25;
export function customerListWhere(ownerId: string, query: CustomerListQuery): Prisma.CustomerWhereInput {
  const term = query.q.replace(/[\\%_]/g, "\\$&");
  const phone = /^\+?[0-9() .-]+$/.test(query.q) ? query.q.replace(/[^0-9]/g, "") : "";
  return {
    ownerId,
    ...(query.status === "active" ? { archivedAt: null } : query.status === "archived" ? { archivedAt: { not: null } } : {}),
    ...(term ? { OR: [
      { fullName: { contains: term, mode: "insensitive" } },
      ...(phone ? [{ phone: { contains: phone } }] : []),
    ] } : {}),
  };
}

async function lockOwner(tx: Prisma.TransactionClient, ownerId: string) {
  const owners = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${ownerId} AND "closedAt" IS NULL FOR SHARE`;
  if (!owners.length) throw new Error("ACCOUNT_CLOSED");
}

async function phoneMatch(tx: Prisma.TransactionClient, ownerId: string, phone: string, excludeId?: string) {
  // Serialize equal phone writes so concurrent creates also receive the advisory warning.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"customer-phone-v1:" + ownerId}), hashtext(${phone}))`;
  return Boolean(await tx.customer.findFirst({
    where: { ownerId, phone, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true },
  }));
}

export function makeCustomerRepository(database = prisma) {
  return {
    async create(ownerId: string, input: CreateCustomerInput) {
      return database.$transaction(async tx => {
        await lockOwner(tx, ownerId);
        const duplicatePhone = await phoneMatch(tx, ownerId, input.phone);
        const customer = await tx.customer.create({ data: {
          ownerId, fullName: input.fullName, phone: input.phone,
          email: input.email, address: input.address, notes: input.notes,
        } });
        return { customer, duplicatePhone };
      });
    },
    async list(ownerId: string, query: CustomerListQuery) {
      const rows = await database.customer.findMany({
        where: customerListWhere(ownerId, query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * CUSTOMER_PAGE_SIZE, take: CUSTOMER_PAGE_SIZE + 1,
      });
      return { customers: rows.slice(0, CUSTOMER_PAGE_SIZE), page: query.page, pageSize: CUSTOMER_PAGE_SIZE, hasMore: rows.length > CUSTOMER_PAGE_SIZE };
    },
    detail(ownerId: string, id: string) {
      return database.customer.findFirst({ where: { id, ownerId } });
    },
    async update(ownerId: string, id: string, input: UpdateCustomerInput) {
      return database.$transaction(async tx => {
        await lockOwner(tx, ownerId);
        if (!await tx.customer.findFirst({ where: { id, ownerId }, select: { id: true } })) throw new Error("CUSTOMER_NOT_FOUND");
        const duplicatePhone = input.phone === undefined ? false : await phoneMatch(tx, ownerId, input.phone, id);
        const updated = await tx.customer.updateMany({ where: { id, ownerId }, data: {
          fullName: input.fullName, phone: input.phone, email: input.email, address: input.address, notes: input.notes,
        } });
        if (!updated.count) throw new Error("CUSTOMER_NOT_FOUND");
        const customer = await tx.customer.findFirstOrThrow({ where: { id, ownerId } });
        return { customer, duplicatePhone };
      });
    },
    async setArchived(ownerId: string, id: string, archived: boolean) {
      return database.$transaction(async tx => {
        await lockOwner(tx, ownerId);
        // Repeated archive/reactivate calls keep the original state timestamp.
        await tx.customer.updateMany({
          where: { id, ownerId, archivedAt: archived ? null : { not: null } },
          data: { archivedAt: archived ? new Date() : null },
        });
        const customer = await tx.customer.findFirst({ where: { id, ownerId } });
        if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
        return customer;
      });
    },
  };
}
