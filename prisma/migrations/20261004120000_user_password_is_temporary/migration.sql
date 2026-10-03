-- R3-12: marks an account that still uses a password an administrator set for it,
-- so staff can be prompted (not forced) to choose their own. Existing accounts
-- start false: there is no record of which of them still use a temporary password.
ALTER TABLE "User" ADD COLUMN "passwordIsTemporary" BOOLEAN NOT NULL DEFAULT false;
