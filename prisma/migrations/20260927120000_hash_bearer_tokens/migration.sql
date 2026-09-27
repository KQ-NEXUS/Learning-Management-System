-- F-14a: session cookies and verification/reset/email-change tokens are now
-- stored only as their SHA-256 hex digest (src/server/auth/token-hash.ts).
-- Existing rows are converted in place with the same digest, so every current
-- session keeps working and every outstanding link still verifies. A raw token
-- is never 64 lowercase hex characters (they are base64url), so rows already in
-- that shape are left alone.

UPDATE "Session"
SET "sessionToken" = encode(sha256(convert_to("sessionToken", 'UTF8')), 'hex')
WHERE "sessionToken" !~ '^[0-9a-f]{64}$';

UPDATE "VerificationToken"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex')
WHERE "token" !~ '^[0-9a-f]{64}$';
