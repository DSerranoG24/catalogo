import type { ItemCompatibility } from "@prisma/client";
import type { UpdateCompatibilityInput } from "../schemas/compatibility.schema";

export function nextCompatibilityReview(current: ItemCompatibility, input: UpdateCompatibilityInput, actorId: string, now = new Date()) {
  const evidenceType = input.evidenceType === undefined ? current.evidenceType : input.evidenceType;
  const evidenceReference = input.evidenceReference === undefined ? current.evidenceReference : input.evidenceReference;
  const note = input.note === undefined ? current.note : input.note;
  const evidenceChanged = evidenceType !== current.evidenceType || evidenceReference !== current.evidenceReference
    || (!current.evidenceReference && note !== current.note);
  const status = input.status ?? (current.status === "VERIFIED" && evidenceChanged ? "PENDING" : current.status);
  if ((["REJECTED", "WITHDRAWN"].includes(current.status) && status !== current.status && status !== "PENDING")
    || (current.status === "VERIFIED" && evidenceChanged && status === "VERIFIED")) throw new Error("INVALID_COMPATIBILITY_TRANSITION");
  if (["REJECTED", "WITHDRAWN"].includes(status) && status !== current.status && (!input.reviewReason || input.reviewReason.length < 3)) throw new Error("COMPATIBILITY_REASON_REQUIRED");
  if (status === "VERIFIED" && current.status !== "VERIFIED" && (!input.evidenceType || !(input.evidenceReference || input.note))) throw new Error("COMPATIBILITY_EVIDENCE_REQUIRED");
  if (status === "VERIFIED" && (!evidenceType || !(evidenceReference || note))) throw new Error("COMPATIBILITY_EVIDENCE_REQUIRED");
  const reviewReason = status === "VERIFIED" ? null : input.reviewReason === undefined ? current.reviewReason : input.reviewReason;
  const data = { status, evidenceType, evidenceReference, note, reviewReason,
    verifiedAt: status === "VERIFIED" ? current.status === "VERIFIED" ? current.verifiedAt : now : null,
    verifiedById: status === "VERIFIED" ? current.status === "VERIFIED" ? current.verifiedById : actorId : null,
  };
  const changed = data.status !== current.status || evidenceChanged || data.reviewReason !== current.reviewReason;
  return { data, changed };
}
