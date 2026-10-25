import { createHash, randomBytes } from "node:crypto";

export type ActionPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";
export const actionTtl = { VERIFY_EMAIL: 24 * 60 * 60_000, RESET_PASSWORD: 30 * 60_000 };
export const hashActionToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const createActionToken = () => randomBytes(32).toString("base64url");

export type ActionUser = { id: string; email: string; passwordHash: string | null; emailVerifiedAt: Date | null; sessionVersion: number };
export type ActionRecord = { userId: string; purpose: ActionPurpose; tokenHash: string; emailAtIssue: string; expiresAt: Date; consumedAt: Date | null; createdAt: Date };

export interface AccountActionStore {
  findByEmail(email: string): Promise<ActionUser | null>;
  findById(userId: string): Promise<ActionUser | null>;
  reserve(userId: string, purpose: ActionPurpose, tokenHash: string, now: Date): Promise<ActionUser | null>;
  consume(tokenHash: string, purpose: ActionPurpose, now: Date, passwordHash?: string): Promise<boolean>;
}

export function canIssueAction(user: ActionUser, purpose: ActionPurpose, recent: ActionRecord[], activeCount: number, now: Date) {
  if (purpose === "VERIFY_EMAIL" && user.emailVerifiedAt) return false;
  if (purpose === "RESET_PASSWORD" && !user.passwordHash) return false;
  if (recent.length >= 5 || activeCount >= 5) return false;
  return !recent.some(token => now.getTime() - token.createdAt.getTime() < 60_000);
}

export function actionTokenValid(token: ActionRecord, user: ActionUser, purpose: ActionPurpose, now: Date) {
  return token.userId === user.id && token.purpose === purpose && token.emailAtIssue === user.email && !token.consumedAt && token.expiresAt > now
    && (purpose !== "RESET_PASSWORD" || Boolean(user.passwordHash));
}
