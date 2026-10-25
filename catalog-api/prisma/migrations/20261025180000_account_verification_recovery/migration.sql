CREATE TYPE "AccountActionPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

ALTER TABLE "users"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "account_action_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "AccountActionPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "emailAtIssue" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_action_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_action_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_action_tokens_tokenHash_key" ON "account_action_tokens"("tokenHash");
CREATE INDEX "account_action_tokens_userId_purpose_createdAt_idx" ON "account_action_tokens"("userId", "purpose", "createdAt");
CREATE INDEX "account_action_tokens_expiresAt_idx" ON "account_action_tokens"("expiresAt");

CREATE TABLE "email_delivery_budgets" (
  "period" TEXT NOT NULL,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "email_delivery_budgets_pkey" PRIMARY KEY ("period")
);
