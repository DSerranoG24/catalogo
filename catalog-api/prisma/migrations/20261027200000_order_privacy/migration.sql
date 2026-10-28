-- Historical consent versions and anonymization dates remain unknown (NULL).
ALTER TABLE "orders"
  ADD COLUMN "customerConsentVersion" TEXT,
  ADD COLUMN "anonymizedAt" TIMESTAMP(3);
