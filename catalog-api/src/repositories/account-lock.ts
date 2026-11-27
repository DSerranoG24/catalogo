import type { Prisma } from "@prisma/client";

/**
 * Single lock order for every operation that moves money or stock (docs/sales-payments-cartera-contract.md, 15.A;
 * Agents.md). One account at a time per owner:
 *
 *   1. pg_advisory_xact_lock(hashtext('account-money-v1'), hashtext(ownerId))   <- this helper, always first
 *   2. users FOR SHARE, rejecting a closed account (ACCOUNT_CLOSED)            <- this helper
 *   3. other per-owner advisory locks (inventory-identity-v1, ...)
 *   4. rows FOR UPDATE, by kind and then by id: order -> customer -> sale -> expense rows -> batch -> inventory items
 *
 * Account closure takes step 1 and then its own orders -> catalogs -> users FOR UPDATE (accountClosureMoneyLock).
 * The users row cannot come first for closure: guard_closed_catalog_write takes users FOR SHARE after the order or
 * catalog row in quotations, order status, anonymization, public orders and catalog edits. The advisory lock is the
 * common point before any row, so closure and order conversion (which locks users before the order) serialize there.
 */
export async function lockAccountForMoney(tx: Prisma.TransactionClient, ownerId: string) {
  await accountClosureMoneyLock(tx, ownerId);
  await lockInventoryOwner(tx, ownerId);
}

/** Step 2 alone: users FOR SHARE of an open account. Account closure takes users FOR UPDATE; stale requests wait. */
export async function lockInventoryOwner(tx: Prisma.TransactionClient, userId: string) {
  const owners = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId} AND "closedAt" IS NULL FOR SHARE`;
  if (!owners.length) throw new Error("ACCOUNT_CLOSED");
}

/** Step 1 only, for account closure, which then locks orders -> catalogs -> users FOR UPDATE. */
export async function accountClosureMoneyLock(tx: Prisma.TransactionClient, ownerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('account-money-v1'), hashtext(${ownerId}))`;
}
