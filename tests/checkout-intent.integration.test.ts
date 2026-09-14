/**
 * Real-Postgres proof of the D-14 checkout-intent detour (REG-02, T-06-20,
 * T-06-21, T-06-23) — the genuine round trip, not a shortcut: an anonymous
 * Enroll click, real registration, a real verification-token consumption
 * (not a browser visit to /verify), a real sign-in, and the resumption
 * route actually taking the seat and creating the Order.
 *
 * Same module-binding discipline as `tests/checkout-webhook.integration.test.ts`:
 * this file takes no static top-level import of anything that transitively
 * imports `@/server/db` (`checkout-service.ts`, `registration-service.ts`,
 * `verification-service.ts`, `auth-service.ts`, `session-service.ts`, the
 * Server Actions, and the resumption page all qualify) — every one of those
 * is imported dynamically inside `beforeAll`, AFTER `process.env.DATABASE_URL`
 * is pointed at the Testcontainers instance, so their singleton `prisma`
 * binds to the same container this file's assertions read from.
 *
 * `next/headers` and `next/navigation` are mocked at the top of the file
 * (hoisted, so the mock is in place before any dynamic import below
 * evaluates them): `cookies()` returns an in-memory fake jar shared across
 * every action/page call in a test, and `redirect()`/`notFound()` throw a
 * recognisable Error the test catches — the same technique used by
 * `tests/checkout-intent.test.ts`'s unit-level fake jar, just against real
 * services instead of mocked ones.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedPaystackNgnFeeScheduleFixture } from "./support/cohort-fixtures";
import { CHECKOUT_INTENT_COOKIE } from "@/server/auth/landing";
import { TOKEN_PURPOSE } from "@/lib/identity";
import { calculateCheckoutBreakdown, type GatewayFeeScheduleValues } from "@/server/payments/pricing";

/** Mirrors `seedPaystackNgnFeeScheduleFixture`'s own values exactly (D-25). */
const PAYSTACK_NGN_SCHEDULE: GatewayFeeScheduleValues = {
  provider: "PAYSTACK",
  currency: "NGN",
  version: 1,
  percentageBps: 150,
  fixedMinor: 10_000,
  waiverThresholdMinor: null,
  capMinor: 200_000,
  taxBps: 0,
  roundingRule: "HALF_UP",
};

const TEST_PASSWORD = "correct-horse-battery-staple";

// A fake cookie jar mirroring Next's `cookies()` surface — get/set/delete
// keyed by name, shared for the lifetime of one `it()` via `beforeEach`'s
// reset. No mock-call assertions needed here (unlike the unit-level fake),
// so these are plain functions, not `vi.fn()`.
const fakeJar = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    reset: () => store.clear(),
    get: (name: string) => {
      const value = store.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      store.set(name, value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
  };
});

vi.mock("next/headers", () => ({ cookies: async () => fakeJar }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("redirect:" + url);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

type CheckoutActionsModule = typeof import("@/app/(checkout)/actions");
type SignInActionsModule = typeof import("@/app/(auth)/signin/actions");
type EnrolPageModule = typeof import("@/app/(checkout)/enrol/[cohortId]/page");
type RegistrationModule = typeof import("@/server/services/registration-service");
type VerificationModule = typeof import("@/server/services/verification-service");

let testDb: TestDatabase;
let enrollAction: CheckoutActionsModule["enrollAction"];
let signInAction: SignInActionsModule["signInAction"];
let EnrolResumptionPage: EnrolPageModule["default"];
let registrationService: RegistrationModule["registrationService"];
let verificationService: VerificationModule["verificationService"];

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;

  // 07-04 — `startTestDatabase()` applies migrations only, never
  // `prisma/seed.ts`; `startCheckout` now needs an active PAYSTACK/NGN
  // `GatewayFeeSchedule` row to compute the D-13 snapshot.
  await seedPaystackNgnFeeScheduleFixture(testDb.prisma);

  ({ enrollAction } = await import("@/app/(checkout)/actions"));
  ({ signInAction } = await import("@/app/(auth)/signin/actions"));
  ({ default: EnrolResumptionPage } = await import(
    "@/app/(checkout)/enrol/[cohortId]/page"
  ));
  ({ registrationService } = await import("@/server/services/registration-service"));
  ({ verificationService } = await import("@/server/services/verification-service"));
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(() => {
  fakeJar.reset();
});

/** Runs an action/page call expected to throw the mocked redirect(), and
 * returns the target path it was called with. Fails the test if the call
 * resolves normally or throws anything else (including the mocked notFound()). */
async function captureRedirect(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("redirect:")) {
      return err.message.slice("redirect:".length);
    }
    throw err;
  }
  throw new Error("expected a redirect(), but the call resolved normally");
}

function enrollFormData(cohortId: string, currency: string = "NGN"): FormData {
  const data = new FormData();
  data.set("cohortId", cohortId);
  data.set("currency", currency);
  return data;
}

function signInFormData(email: string, password: string = TEST_PASSWORD): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

/** Registers a brand-new learner and consumes their verification token via
 * `verificationService.verifyEmail` directly — the genuine round trip's
 * email-link step, without a browser visit to /verify (per this plan's own
 * action text). */
async function registerAndVerify(email: string): Promise<void> {
  const result = await registrationService.registerLearner({
    email,
    password: TEST_PASSWORD,
    name: "Fixture Learner",
    phone: null,
    acceptedTerms: true,
    acceptedPrivacy: true,
  });
  expect(result.ok).toBe(true);

  const tokenRow = await testDb.prisma.verificationToken.findFirstOrThrow({
    where: {
      identifier: email.toLowerCase().trim(),
      purpose: TOKEN_PURPOSE.EMAIL_VERIFICATION,
    },
    orderBy: { createdAt: "desc" },
  });

  const verified = await verificationService.verifyEmail(tokenRow.token);
  expect(verified.ok).toBe(true);
}

describe("checkout-intent round trip — real Postgres (REG-02)", () => {
  it("Enroll while signed out -> register -> verify -> sign in lands on the order summary for the originally selected cohort, at its live price", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 5,
      seatsTaken: 0,
      priceMinor: 12_345,
      currency: "NGN",
    });
    const email = `${randomUUID()}@fixture.test`;

    // 1. Enroll while signed out — captures the intent cookie (now
    // `${cohortId}.${currency}`, D-07), redirects to sign-in.
    const enrollTarget = await captureRedirect(() => enrollAction(enrollFormData(cohortId, "NGN")));
    expect(enrollTarget).toBe("/signin");
    expect(fakeJar.get(CHECKOUT_INTENT_COOKIE)?.value).toBe(`${cohortId}.NGN`);

    // 2. Register -> verify, via the real services (no browser /verify visit).
    await registerAndVerify(email);
    // The intent cookie is untouched by registration/verification — neither
    // creates a session, so neither has a redirect to make (Task 2's own
    // action text) — it simply persists across them.
    expect(fakeJar.get(CHECKOUT_INTENT_COOKIE)?.value).toBe(`${cohortId}.NGN`);

    // 3. Sign in — consumes and clears the intent, resolves the resumption
    // path with the currency carried through as a query parameter.
    const signInTarget = await captureRedirect(() =>
      signInAction({ error: null }, signInFormData(email)),
    );
    expect(signInTarget).toBe(`/enrol/${cohortId}?currency=NGN`);
    expect(fakeJar.get(CHECKOUT_INTENT_COOKIE)).toBeUndefined();

    // 4. Follow the resumption route — takes the seat, creates the Order,
    // redirects to the order summary.
    const orderTarget = await captureRedirect(() =>
      EnrolResumptionPage({ params: Promise.resolve({ cohortId }), searchParams: Promise.resolve({ currency: "NGN" }) }),
    );
    expect(orderTarget).toMatch(/^\/checkout\//);
    const orderId = orderTarget.replace("/checkout/", "");

    const order = await testDb.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    // The prohibition this plan exists to close: neither the cohort nor the
    // price may drift across the detour. `amountMinor` is now the full D-13
    // commercial snapshot (base + platform fee + gateway estimate), not the
    // bare base price — cross-checked against the same calculator this
    // Order's own creation used.
    const expectedBreakdown = calculateCheckoutBreakdown({
      baseAmountMinor: 12_345,
      schedule: PAYSTACK_NGN_SCHEDULE,
    });
    expect(order.cohortId).toBe(cohortId);
    expect(order.baseAmountMinor).toBe(12_345);
    expect(order.amountMinor).toBe(expectedBreakdown.totalAmountMinor);
    expect(order.currency).toBe("NGN");
    expect(order.selectedProvider).toBe("PAYSTACK");

    // 5. A second, unrelated sign-in after the first consumed the intent
    // lands on /account, not back in checkout (single-use).
    const secondSignInTarget = await captureRedirect(() =>
      signInAction({ error: null }, signInFormData(email)),
    );
    expect(secondSignInTarget).toBe("/account");
  }, 15_000);

  it("lands on /account when no intent cookie is present (pre-existing behaviour unchanged)", async () => {
    const email = `${randomUUID()}@fixture.test`;
    await registerAndVerify(email);

    const target = await captureRedirect(() => signInAction({ error: null }, signInFormData(email)));
    expect(target).toBe("/account");
  }, 15_000);

  it("lands on the cohort's public offer page with no Order created when the held cohort filled up in the meantime", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, {
      capacity: 1,
      seatsTaken: 1, // already full by the time sign-in resumes
      priceMinor: 5_000,
      currency: "NGN",
    });
    const email = `${randomUUID()}@fixture.test`;
    await registerAndVerify(email);

    // Simulate the intent cookie having been set earlier, before the cohort filled up.
    fakeJar.set(CHECKOUT_INTENT_COOKIE, `${cohortId}.NGN`);

    const signInTarget = await captureRedirect(() =>
      signInAction({ error: null }, signInFormData(email)),
    );
    expect(signInTarget).toBe(`/enrol/${cohortId}?currency=NGN`);

    const resumeTarget = await captureRedirect(() =>
      EnrolResumptionPage({ params: Promise.resolve({ cohortId }), searchParams: Promise.resolve({ currency: "NGN" }) }),
    );
    expect(resumeTarget.startsWith("/courses/")).toBe(true);

    const orders = await testDb.prisma.order.findMany({ where: { cohortId } });
    expect(orders).toHaveLength(0);
  }, 15_000);

  it("a non-existent cohort id at the resumption route produces the 404 page", async () => {
    const email = `${randomUUID()}@fixture.test`;
    await registerAndVerify(email);
    const bogusCohortId = "cnonexistentcohortid00000";
    fakeJar.set(CHECKOUT_INTENT_COOKIE, `${bogusCohortId}.NGN`);

    const signInTarget = await captureRedirect(() =>
      signInAction({ error: null }, signInFormData(email)),
    );
    expect(signInTarget).toBe(`/enrol/${bogusCohortId}?currency=NGN`);

    await expect(
      EnrolResumptionPage({ params: Promise.resolve({ cohortId: bogusCohortId }), searchParams: Promise.resolve({ currency: "NGN" }) }),
    ).rejects.toThrow("notFound");
  }, 15_000);
});
