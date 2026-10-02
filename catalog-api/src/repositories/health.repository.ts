import { prisma } from "../config/prisma";

export async function checkDatabaseConnection() {
  await prisma.$queryRaw`SELECT 1`;

  return true;
}