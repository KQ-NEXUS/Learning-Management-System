/**
 * Opt-in, manual-only live check of the real Brevo transport (D-24) — closes
 * Phase 3's declined Brevo-outage live check
 * (`.planning/v1.0-MILESTONE-AUDIT.md`).
 *
 * Both cases below use `it.skipIf(!process.env.BREVO_LIVE)` — without
 * `BREVO_LIVE` this file always exits 0 with both cases reported skipped,
 * exactly like ordinary CI. Every credential and the recipient address come
 * from the environment only; nothing here is a fixture literal that could
 * leak a real key or mailbox.
 *
 * HOW TO RUN (manual only — never in CI):
 *   1. Export the seven variables `13-13-PLAN.md`'s `user_setup` documents:
 *      BREVO_LIVE=1
 *      BREVO_LIVE_TO=<a mailbox you control>
 *      BREVO_API_KEY=<a real Brevo API key>
 *      EMAIL_SENDER_NAME=<the approved sender display name>
 *      EMAIL_SENDER_ADDRESS=<a sender address verified in Brevo>
 *      SUPPORT_CONTACT_EMAIL=<the support mailbox used as Reply-To>
 *      APP_BASE_URL=<the public origin used to build links>
 *   2. Run: npx vitest run tests/brevo-live.smoke.test.ts
 *   3. Confirm receipt of the "ticket-reply" sample mail at BREVO_LIVE_TO,
 *      and check the From identity and Reply-To header in that mailbox.
 *
 * Case 2 needs Docker (tests/support/pg.ts starts a throwaway Postgres) and
 * network access to Brevo's real endpoint with a deliberately invalid key.
 */

import { describe, expect, it } from "vitest";
import {
  sendTransactionalEmail,
  classifyBrevoFailure,
  describeBrevoFailure,
} from "@/server/email/brevo-client";
import { getEmailTransportMode } from "@/server/email/config";
import { renderEmail, TEMPLATE_SAMPLES } from "@/server/email/templates/registry";
import { sendAuthEmail } from "@/server/services/auth-email-service";
import {
  createEmailDispatchService,
  createPrismaEmailDispatchStore,
  buildAuthCorrelationId,
} from "@/server/services/email-dispatch-service";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

const LIVE = !!process.env.BREVO_LIVE;

describe("Brevo live smoke (D-24, opt-in — set BREVO_LIVE=1 to run for real)", () => {
  it.skipIf(!LIVE)(
    "case 1: sends one real templated email through live Brevo and returns a non-stub provider message id",
    async () => {
      // The precondition this case depends on: EMAIL_TRANSPORT must be unset
      // or "brevo" — getEmailTransportMode() throws for any other value, and
      // "stub" would never reach the real provider (defeating this case's
      // whole point).
      expect(getEmailTransportMode()).toBe("brevo");

      const to = (process.env.BREVO_LIVE_TO ?? "").trim();
      if (!to) {
        throw new Error("BREVO_LIVE_TO must be set for the live Brevo smoke test.");
      }

      const rendered = renderEmail("ticket-reply", TEMPLATE_SAMPLES["ticket-reply"]);

      const result = await sendTransactionalEmail({
        to,
        subject: rendered.subject,
        textContent: rendered.text,
        htmlContent: rendered.html,
        tags: ["brevo-live-smoke"],
      });

      expect(result.providerMessageId).toBeTruthy();
      expect(result.providerMessageId?.startsWith("stub:")).toBe(false);

      console.info(
        `[brevo-live-smoke] Live "ticket-reply" email sent to ${to} (provider message id: ` +
          `${result.providerMessageId}). Operator: confirm receipt, the From identity, and the ` +
          `Reply-To header in that mailbox.`,
      );
    },
    120_000,
  );

  it.skipIf(!LIVE)(
    "case 2: a live provider rejection (invalid API key) classifies as permanent, marks the EmailDispatch row FAILED with no leaked secret, and sendAuthEmail still resolves { sent: false }",
    async () => {
      const originalApiKey = process.env.BREVO_API_KEY;
      let testDb: TestDatabase | undefined;
      let capturedError: unknown;

      try {
        testDb = await startTestDatabase();

        // Deliberately invalid — provokes a genuine provider rejection
        // against the real Brevo endpoint (network access required, no
        // valid credentials needed for this case).
        process.env.BREVO_API_KEY = "invalid-live-smoke-key-deliberately-wrong";

        const store = createPrismaEmailDispatchStore(testDb.prisma);
        const dispatchService = createEmailDispatchService({
          store,
          // Wraps the real transport so the raw rejection can be classified
          // directly (dispatch()/sendAuthEmail() both swallow it into
          // { sent: false } before it ever reaches this test).
          send: async (params) => {
            try {
              return await sendTransactionalEmail(params);
            } catch (error) {
              capturedError = error;
              throw error;
            }
          },
          describeFailure: describeBrevoFailure,
          classifyFailure: classifyBrevoFailure,
          render: renderEmail,
        });

        const user = await testDb.prisma.user.create({
          data: {
            email: `brevo-live-smoke-${Date.now()}@example.test`,
            name: "Brevo Live Smoke Learner",
            status: "PENDING_VERIFICATION",
          },
        });

        const token = "brevo-live-smoke-token-never-persisted";
        const outcome = await sendAuthEmail(dispatchService.dispatch, {
          template: "email-verification",
          toEmail: user.email,
          userId: user.id,
          path: "/verify-email",
          token,
          ttlMs: 24 * 60 * 60 * 1000,
        });

        // The calling flow's frozen result — sendAuthEmail never throws.
        expect(outcome).toEqual({ sent: false });

        expect(capturedError).toBeDefined();
        expect(classifyBrevoFailure(capturedError)).toBe("permanent");

        const correlationId = buildAuthCorrelationId(token);
        const dispatchRow = await testDb.prisma.emailDispatch.findUniqueOrThrow({
          where: { template_correlationId: { template: "email-verification", correlationId } },
        });
        expect(dispatchRow.status).toBe("FAILED");
        expect(dispatchRow.error).toBeTruthy();
        expect(dispatchRow.error).not.toContain(process.env.BREVO_API_KEY);
        expect(dispatchRow.error).not.toContain(user.email);
      } finally {
        process.env.BREVO_API_KEY = originalApiKey;
        await testDb?.stop();
      }
    },
    TEST_DB_TIMEOUT_MS,
  );
});
