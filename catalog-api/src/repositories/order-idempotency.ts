import { Prisma } from "@prisma/client";

export function isIdempotencyUniqueConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  const targetText = Array.isArray(target) ? target.join(" ") : String(target ?? "");
  return targetText.includes("catalogId") && targetText.includes("idempotencyKey");
}

export async function recoverIdempotentOrder<T>(
  key: string | undefined,
  createWithinTransaction: () => Promise<T>,
  findPersistedReceipt: () => Promise<T | null>
): Promise<T> {
  try {
    return await createWithinTransaction();
  } catch (error) {
    if (!key || !isIdempotencyUniqueConflict(error)) throw error;

    const existing = await findPersistedReceipt();
    if (!existing) throw error;

    // La repetición recupera el recibo persistido para tolerar reintentos de red.
    return existing;
  }
}
