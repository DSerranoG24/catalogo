import bcrypt from "bcrypt";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { prisma } from "../config/prisma";
import type { Prisma } from "@prisma/client";
import { accountClosureMoneyLock } from "../repositories/account-lock";
import { attachPayments, creditBalanceOf } from "./sale-payment";

export type ClosureCredentials = { password?: string; idToken?: string; confirmOpenBalances?: boolean };

/** Thrown when closure would leave money or deliveries open and the owner has not confirmed the preview. */
export class ClosureConfirmationRequired extends Error {
  constructor(readonly preview: ClosurePreview) { super("ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION"); }
}
export type ClosurePreview = Awaited<ReturnType<typeof readClosurePreview>>;
const unresolvedOrdersWhere = (userId: string) => ({ catalog: { userId }, OR: [{ status: { in: ["PENDING" as const, "CONFIRMED" as const] } }, { anonymizedAt: null }] });

/**
 * What closing would leave open (correction C): money pending on confirmed sales, unpaid delivered balances,
 * customer credit balances, money «por devolver» on sales without a customer, sales not delivered and orders to
 * review. Amounts are BigInt COP. Read-only.
 */
export async function readClosurePreview(tx: Prisma.TransactionClient, userId: string) {
  const unresolvedOrders = await tx.order.count({ where: unresolvedOrdersWhere(userId) });
  const undeliveredSales = await tx.sale.count({ where: { userId, status: "CONFIRMED" } });
  const tracked = await tx.sale.findMany({ where: { userId, paymentMode: "TRACKED", status: { not: "DRAFT" } }, include: { lines: true, returns: { include: { lines: true } } } });
  let pendingOrderBalance = 0n, balanceDue = 0n, refundDue = 0n, refundDueSales = 0;
  for (const sale of await attachPayments(tx, userId, tracked, false)) {
    const figures = sale.payments as { balance: bigint; refundDue: bigint };
    if (sale.status === "CONFIRMED") pendingOrderBalance += figures.balance;
    if (sale.status === "DELIVERED") balanceDue += figures.balance;
    if (figures.refundDue > 0n) { refundDue += figures.refundDue; refundDueSales += 1; }
  }
  const credits = await tx.customerCreditEntry.findMany({ where: { ownerId: userId }, select: { id: true, customerId: true, kind: true, amount: true, reversesEntryId: true } });
  const byCustomer = new Map<string, typeof credits>();
  for (const entry of credits) byCustomer.set(entry.customerId, [...(byCustomer.get(entry.customerId) ?? []), entry]);
  let creditTotal = 0n, creditCustomers = 0;
  for (const entries of byCustomer.values()) { const balance = creditBalanceOf(entries); if (balance > 0n) { creditTotal += balance; creditCustomers += 1; } }
  const requiresConfirmation = undeliveredSales > 0 || pendingOrderBalance > 0n || balanceDue > 0n || refundDue > 0n || creditTotal > 0n;
  return { unresolvedOrders, undeliveredSales, pendingOrderBalance, balanceDue, customerCredit: { total: creditTotal, customers: creditCustomers },
    refundDue: { total: refundDue, sales: refundDueSales }, requiresConfirmation };
}

/** GET /auth/close/preview: same figures, in a read-only transaction. */
export async function closurePreview(userId: string, database = prisma) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    // A plain read (FOR SHARE is not allowed in a READ ONLY transaction): a closed account gets no preview.
    if (!await tx.user.findFirst({ where: { id: userId, closedAt: null }, select: { id: true } })) throw new Error("ACCOUNT_CLOSED");
    return readClosurePreview(tx, userId);
  });
}
const google = new OAuth2Client();

// Signature and audience are verified by google-auth-library before this check.
export function validateRecentClosureGoogleIdentity(payload: TokenPayload | undefined, googleId: string, now: number) {
  const seconds = Math.floor(now / 1000);
  if (payload?.sub !== googleId || payload.email_verified !== true
    || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)
    || typeof payload.iat !== "number" || payload.iat < seconds - 300 || payload.iat > seconds + 30
    || typeof payload.exp !== "number" || payload.exp <= seconds) throw new Error("REAUTH_REQUIRED");
}

export async function verifyClosureCredentials(user: { passwordHash: string | null; googleId: string | null }, input: ClosureCredentials, now = Date.now()) {
  if (user.passwordHash) {
    if (!input.password || !await bcrypt.compare(input.password, user.passwordHash)) throw new Error("REAUTH_REQUIRED");
    return;
  }
  if (!input.idToken || !user.googleId || !process.env.GOOGLE_CLIENT_ID) throw new Error("REAUTH_REQUIRED");
  const ticket = await google.verifyIdToken({ idToken: input.idToken, audience: process.env.GOOGLE_CLIENT_ID });
  validateRecentClosureGoogleIdentity(ticket.getPayload(), user.googleId, now);
}

export async function requestAccountClosure(userId: string, input: ClosureCredentials, database = prisma, reauthenticate = verifyClosureCredentials) {
  const user = await database.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("REAUTH_REQUIRED");
  await reauthenticate(user, input);
  return database.$transaction(async tx => {
    // Account money lock first (Agents.md): closure and every money/stock operation, order conversion included,
    // serialize here. Then order -> catalog -> user: do not invert quotation issuance's lock order.
    await accountClosureMoneyLock(tx, userId);
    await tx.$queryRaw`SELECT o.id FROM orders o JOIN catalogs c ON c.id = o."catalogId" WHERE c."userId" = ${userId} ORDER BY o.id FOR UPDATE OF o`;
    await tx.$queryRaw`SELECT id FROM catalogs WHERE "userId" = ${userId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await tx.accountClosureJob.findUnique({ where: { userId } });
    if (existing) return { id: existing.id, phase: existing.phase };
    if (current.passwordHash !== user.passwordHash || current.googleId !== user.googleId || current.sessionVersion !== user.sessionVersion) throw new Error("REAUTH_REQUIRED");
    const catalogs = await tx.catalog.findMany({ where: { userId }, select: { id: true } });
    for (const catalog of catalogs) await tx.$queryRaw`SELECT id FROM catalogs WHERE id = ${catalog.id} FOR UPDATE`;
    const unresolved = await tx.order.count({ where: unresolvedOrdersWhere(userId) });
    if (unresolved) throw new Error("ACCOUNT_ORDERS_REQUIRE_REVIEW");
    // Under the account money lock no payment can change these figures before the commit.
    const preview = await readClosurePreview(tx, userId);
    if (preview.requiresConfirmation && input.confirmOpenBalances !== true) throw new ClosureConfirmationRequired(preview);
    await tx.catalog.updateMany({ where: { userId }, data: { active: false, archivedAt: new Date() } });
    await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 }, closedAt: new Date() } });
    await tx.accountActionToken.deleteMany({ where: { userId } });
    const ids = catalogs.map(catalog => catalog.id);
    const job = await tx.accountClosureJob.create({ data: { userId, catalogIds: ids, scanQueue: ids, pendingPaths: [] } });
    return { id: job.id, phase: job.phase };
  }, { timeout: 15000 });
}
