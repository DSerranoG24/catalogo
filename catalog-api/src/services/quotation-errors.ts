import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

let fallbackSequence = 0;
export function quotationRequestId(): string {
  try { return randomUUID(); }
  catch { return `request-${Date.now().toString(36)}-${++fallbackSequence}`; }
}

export function quotationErrorCode(error: unknown): string {
  if (error instanceof ZodError) return "SNAPSHOT_VALIDATION";
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (["P2028", "P2024", "P2034"].includes(error.code)) return "TRANSACTION_UNAVAILABLE";
    if (error.code === "P2002") return "UNIQUENESS_CONFLICT";
    return "DATABASE_ERROR";
  }
  if (error instanceof Error) {
    if (["PUBLIC_API_URL_REQUIRED", "INVALID_PUBLIC_API_URL"].includes(error.message)
      || (error instanceof TypeError && "code" in error && error.code === "ERR_INVALID_URL")) return "CONFIGURATION";
    if (["INCOMPLETE_QUOTATION", "QUOTATION_WRITE_CONFLICT", "INVALID_QUOTATION_NUMBER"].includes(error.message)) return "QUOTATION_INTEGRITY";
  }
  return "ISSUANCE_FAILED";
}

export type QuotationFailureEvent = { event: "quotation_issue_failed"; requestId: string; errorCode: string };
export function logQuotationFailure(event: QuotationFailureEvent): void {
  console.error(JSON.stringify(event));
}
