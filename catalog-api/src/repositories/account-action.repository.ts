import { prisma } from "../config/prisma";
import { actionTtl, actionTokenValid, canIssueAction, type AccountActionStore } from "../services/account-action";

export function makeAccountActionStore(database = prisma): AccountActionStore {
return {
  findByEmail: email => database.user.findUnique({ where: { email } }),
  findById: id => database.user.findUnique({ where: { id } }),
  reserve: (userId, purpose, tokenHash, now) => database.$transaction(async tx => {
    // Shared budget lock first, then the user lock; consumers only take the user lock.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(19387261)`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    const recent = await tx.accountActionToken.findMany({ where: { userId, purpose, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } });
    const active = await tx.accountActionToken.count({ where: { userId, purpose, consumedAt: null, expiresAt: { gt: now } } });
    if (!canIssueAction(user, purpose, recent, active, now)) return null;
    const periods = [{ period: `day:${now.toISOString().slice(0, 10)}`, limit: 100 }, { period: `month:${now.toISOString().slice(0, 7)}`, limit: 3000 }];
    for (const { period, limit } of periods) {
      const budget = await tx.emailDeliveryBudget.findUnique({ where: { period } });
      if ((budget?.reserved ?? 0) >= limit) return null;
    }
    for (const { period } of periods) await tx.emailDeliveryBudget.upsert({ where: { period }, create: { period, reserved: 1 }, update: { reserved: { increment: 1 } } });
    await tx.accountActionToken.create({ data: { userId, purpose, tokenHash, emailAtIssue: user.email, createdAt: now, expiresAt: new Date(now.getTime() + actionTtl[purpose]) } });
    return user;
  }),
  consume: async (tokenHash, purpose, now, passwordHash) => database.$transaction(async tx => {
    const initial = await tx.accountActionToken.findUnique({ where: { tokenHash } });
    if (!initial) return false;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.userId} FOR UPDATE`;
    const token = await tx.accountActionToken.findUnique({ where: { tokenHash } });
    const user = await tx.user.findUnique({ where: { id: initial.userId } });
    if (!token || !user || !actionTokenValid(token, user, purpose, now) || (purpose === "RESET_PASSWORD" && !passwordHash)) return false;
    const claimed = await tx.accountActionToken.updateMany({ where: { id: token.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (claimed.count !== 1) return false;
    await tx.user.update({ where: { id: user.id }, data: purpose === "VERIFY_EMAIL" ? { emailVerifiedAt: user.emailVerifiedAt ?? now } : {
      passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? now, sessionVersion: { increment: 1 },
    } });
    await tx.accountActionToken.updateMany({ where: { userId: user.id, consumedAt: null, ...(purpose === "VERIFY_EMAIL" ? { purpose } : {}) }, data: { consumedAt: now } });
    return true;
  }),
};
}
export const accountActionStore = makeAccountActionStore();
