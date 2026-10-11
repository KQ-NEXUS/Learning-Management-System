/**
 * Environment for the application server the browser journey starts
 * (Phase 15, plan 15-15; D-08).
 *
 * Every value here is a local test value. There is no secret in this file: the
 * Brevo key is a placeholder the local capture server never checks, and the
 * database URL comes from the shell and must name a local database.
 *
 * The importing process is the Playwright runner, so `DATABASE_URL` is checked
 * the moment the config loads: a shell that carries the shared database URL
 * stops the run before any server starts.
 */

import { assertSafeDatabaseUrl } from "../../scripts/ops/db-target-guard";

/**
 * The host name is `localhost`, never the numeric loopback address: Secure
 * cookies set by `next start` over http are kept for `localhost` by every
 * engine, while some drop them for the numeric address.
 */
export const APP_PORT = 3010;
export const APP_ORIGIN = `http://localhost:${APP_PORT}`;
export const CAPTURE_PORT = 4010;
export const CAPTURE_ORIGIN = `http://localhost:${CAPTURE_PORT}`;

/**
 * Local object storage for uploads and certificate PDFs (plan 15-17). This is a
 * throwaway MinIO container on the loopback address (see the SUMMARY for the one
 * `docker run` line); the values below are local test values, not secrets, and
 * the browser PUTs submission files straight to this endpoint with a presigned URL.
 */
export const LOCAL_S3 = {
  endpoint: "http://127.0.0.1:9000",
  bucket: "lms-journey",
  accessKeyId: "journeyminio",
  secretAccessKey: "journey-minio-secret",
} as const;

/**
 * The manual-payment path (ledger P-01) needs no payment provider call. The
 * Paystack settlement code only switches the Naira rail on in the public
 * catalogue so the "Pay in NGN" button appears; the placeholder is never sent to
 * a provider because the journey confirms payment through the staff screen.
 */
const LOCAL_PAYSTACK_SUBACCOUNT = "ACCT_local_journey_placeholder";

export function appServerEnv(): Record<string, string> {
  const databaseUrl = process.env.DATABASE_URL;
  // Throws, naming the host only, unless the shell URL is local.
  assertSafeDatabaseUrl(databaseUrl);

  return {
    DATABASE_URL: databaseUrl as string,
    EMAIL_TRANSPORT: "brevo",
    BREVO_API_KEY: "local-test-key",
    BREVO_API_BASE_URL: CAPTURE_ORIGIN,
    APP_BASE_URL: APP_ORIGIN,
    EMAIL_SENDER_NAME: "Journey Test School",
    EMAIL_SENDER_ADDRESS: "no-reply@journey.test",
    SUPPORT_CONTACT_EMAIL: "support@journey.test",
    S3_ENDPOINT: LOCAL_S3.endpoint,
    S3_PUBLIC_ENDPOINT: LOCAL_S3.endpoint,
    S3_BUCKET: LOCAL_S3.bucket,
    S3_ACCESS_KEY_ID: LOCAL_S3.accessKeyId,
    S3_SECRET_ACCESS_KEY: LOCAL_S3.secretAccessKey,
    S3_FORCE_PATH_STYLE: "true",
    PAYSTACK_SUBACCOUNT_CODE: LOCAL_PAYSTACK_SUBACCOUNT,
  };
}

/**
 * The same storage and email values for scripts the journey spawns (`runTask`), which read
 * `process.env` of the Playwright process: the certificate PDF is written to
 * storage by the task runner or the app, so both must name the same bucket.
 */
export function applyTaskEnvToProcess(): void {
  process.env.S3_ENDPOINT = LOCAL_S3.endpoint;
  process.env.S3_PUBLIC_ENDPOINT = LOCAL_S3.endpoint;
  process.env.S3_BUCKET = LOCAL_S3.bucket;
  process.env.S3_ACCESS_KEY_ID = LOCAL_S3.accessKeyId;
  process.env.S3_SECRET_ACCESS_KEY = LOCAL_S3.secretAccessKey;
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.EMAIL_TRANSPORT = "brevo";
  process.env.BREVO_API_KEY = "local-test-key";
  process.env.BREVO_API_BASE_URL = CAPTURE_ORIGIN;
  process.env.APP_BASE_URL = APP_ORIGIN;
  process.env.EMAIL_SENDER_NAME = "Journey Test School";
  process.env.EMAIL_SENDER_ADDRESS = "no-reply@journey.test";
  process.env.SUPPORT_CONTACT_EMAIL = "support@journey.test";
}
