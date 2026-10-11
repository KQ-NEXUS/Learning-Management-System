-- D-12 / NFR-11: staff can anonymise a learner account in place. The row is never
-- deleted. anonymisedAt marks an anonymised account and is the compare-and-set
-- guard against a double anonymisation; anonymisedById records which staff member
-- did it. Both are nullable, so existing rows are untouched.
ALTER TABLE "User" ADD COLUMN "anonymisedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "anonymisedById" TEXT;
