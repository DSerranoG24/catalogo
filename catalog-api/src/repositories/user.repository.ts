import { prisma } from "../config/prisma";

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: {
      email,
    },
  });
}

export async function findUserById(id: string) {
  return prisma.user.findUnique({
    where: {
      id,
    },
  });
}

export async function findUserRoleById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { role: true } });
}

export async function createUser(data: {
  email: string;
  passwordHash: string;
  name?: string;
}, database = prisma) {
  return database.user.create({
    data: { email: data.email, passwordHash: data.passwordHash, name: data.name, role: "USER" },
  });
}

export async function findUserByGoogleId(googleId: string) {
  return prisma.user.findUnique({ where: { googleId } });
}

export async function createGoogleUser(data: {
  email: string;
  name?: string;
  googleId: string;
  emailVerifiedAt?: Date;
}, database = prisma) {
  return database.user.create({ data: { email: data.email, name: data.name, googleId: data.googleId, emailVerifiedAt: data.emailVerifiedAt, role: "USER" } });
}

export async function linkGoogleUser(userId: string, email: string, passwordHash: string, sessionVersion: number, googleId: string, authoritative: boolean) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: userId } });
    if (!current || current.email !== email || current.passwordHash !== passwordHash || current.sessionVersion !== sessionVersion || (current.googleId && current.googleId !== googleId)) throw new Error("GOOGLE_LINK_REJECTED");
    return tx.user.update({ where: { id: userId }, data: { googleId, ...(authoritative && !current.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}) } });
  });
}
