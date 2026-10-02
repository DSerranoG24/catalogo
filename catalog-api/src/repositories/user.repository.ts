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

export async function createUser(data: {
  email: string;
  passwordHash: string;
  name?: string;
}) {
  return prisma.user.create({
    data,
  });
}

export async function findUserByGoogleId(googleId: string) {
  return prisma.user.findUnique({ where: { googleId } });
}

export async function createGoogleUser(data: {
  email: string;
  name?: string;
  googleId: string;
}) {
  return prisma.user.create({ data });
}

export async function attachGoogleId(userId: string, googleId: string) {
  return prisma.user.update({ where: { id: userId }, data: { googleId } });
}