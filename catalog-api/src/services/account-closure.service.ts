import bcrypt from "bcrypt";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { prisma } from "../config/prisma";

export type ClosureCredentials = { password?: string; idToken?: string };
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
    // Order -> catalog -> user: do not invert quotation issuance's lock order.
    await tx.$queryRaw`SELECT o.id FROM orders o JOIN catalogs c ON c.id = o."catalogId" WHERE c."userId" = ${userId} ORDER BY o.id FOR UPDATE OF o`;
    await tx.$queryRaw`SELECT id FROM catalogs WHERE "userId" = ${userId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const existing = await tx.accountClosureJob.findUnique({ where: { userId } });
    if (existing) return { id: existing.id, phase: existing.phase };
    if (current.passwordHash !== user.passwordHash || current.googleId !== user.googleId || current.sessionVersion !== user.sessionVersion) throw new Error("REAUTH_REQUIRED");
    const catalogs = await tx.catalog.findMany({ where: { userId }, select: { id: true } });
    for (const catalog of catalogs) await tx.$queryRaw`SELECT id FROM catalogs WHERE id = ${catalog.id} FOR UPDATE`;
    const unresolved = await tx.order.count({ where: { catalog: { userId }, OR: [
      { status: { in: ["PENDING", "CONFIRMED"] } }, { anonymizedAt: null },
    ] } });
    if (unresolved) throw new Error("ACCOUNT_ORDERS_REQUIRE_REVIEW");
    await tx.catalog.updateMany({ where: { userId }, data: { active: false, archivedAt: new Date() } });
    await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 }, closedAt: new Date() } });
    await tx.accountActionToken.deleteMany({ where: { userId } });
    const ids = catalogs.map(catalog => catalog.id);
    const job = await tx.accountClosureJob.create({ data: { userId, catalogIds: ids, scanQueue: ids, pendingPaths: [] } });
    return { id: job.id, phase: job.phase };
  }, { timeout: 15000 });
}
