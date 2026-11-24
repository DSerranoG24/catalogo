import { createHash } from "node:crypto";

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * Hash of a sales command. requestId identifies one HTTP transmission, not the
 * business intention, so it is excluded: the same operationId with the same content
 * and a new requestId is a retry of the same operation.
 */
export function saleCommandHash(input: object) {
  const { requestId: _transport, ...command } = input as Record<string, unknown>;
  return sha256(command);
}

/**
 * True when a stored receipt belongs to this command. Receipts written before
 * 2026-11-25 hashed the whole body, requestId included; an exact retry of one of
 * those (same requestId) is still recognised.
 */
export function isSameSaleCommand(storedHash: string, input: object) {
  return storedHash === saleCommandHash(input) || storedHash === sha256(input);
}
