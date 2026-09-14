import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake cookie jar mirroring Next's `cookies()` surface closely enough for
// these actions: get/set/delete keyed by name, `set` recording its full
// options object so flag assertions can inspect it directly.
const fakeJar = vi.hoisted(() => {
  const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
  return {
    store,
    reset: () => store.clear(),
    get: vi.fn((name: string) => {
      const entry = store.get(name);
      return entry ? { name, value: entry.value } : undefined;
    }),
    set: vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
      store.set(name, { value, options });
    }),
    delete: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
});

vi.mock("next/headers", () => ({ cookies: async () => fakeJar }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("redirect:" + url);
  },
}));

const mocks = vi.hoisted(() => ({
  getCurrentActor: vi.fn(),
  startCheckout: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/checkout-service", () => ({
  startCheckout: mocks.startCheckout,
  // 07-04 — `enrollAction` also imports this typed refusal from the same
  // module; a mock factory that omits it makes `err instanceof
  // CurrencyUnavailableError` throw (the right-hand side would be
  // `undefined`), not merely evaluate to `false`.
  CurrencyUnavailableError: class CurrencyUnavailableError extends Error {},
}));
vi.mock("@/server/services/seat-accounting", () => ({
  HOLD_MINUTES_DEFAULT: 30,
  AlreadyEnrolledError: class AlreadyEnrolledError extends Error {},
  CapacityExceededError: class CapacityExceededError extends Error {},
  CohortClosedError: class CohortClosedError extends Error {},
  CohortNotFoundError: class CohortNotFoundError extends Error {},
}));
vi.mock("@/server/services/auth-service", () => ({
  signIn: mocks.signIn,
  signOut: vi.fn(),
}));

import { enrollAction } from "@/app/(checkout)/actions";
import { signInAction } from "@/app/(auth)/signin/actions";
import { CHECKOUT_INTENT_COOKIE, CHECKOUT_INTENT_MAX_AGE_SECONDS } from "@/server/auth/landing";
import { SESSION_COOKIE } from "@/server/auth/lockout";
import { AlreadyEnrolledError } from "@/server/services/seat-accounting";

function enrollForm(cohortId = "clh3x9f9a0000356k2j5g8h2q", currency = "NGN") {
  const data = new FormData();
  data.set("cohortId", cohortId);
  data.set("currency", currency);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeJar.reset();
});

describe("enrollAction — anonymous branch sets the checkout-intent cookie", () => {
  it("sets the intent cookie to '{cohortId}.{currency}' and redirects to /signin when unauthenticated", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    const cohortId = "clh3x9f9a0000356k2j5g8h2q";

    await expect(enrollAction(enrollForm(cohortId, "NGN"))).rejects.toThrow("redirect:/signin");

    expect(fakeJar.set).toHaveBeenCalledWith(
      CHECKOUT_INTENT_COOKIE,
      `${cohortId}.NGN`,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: CHECKOUT_INTENT_MAX_AGE_SECONDS,
      }),
    );
  });

  it("sets the cookie with secure:false outside production", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    await expect(enrollAction(enrollForm())).rejects.toThrow("redirect:/signin");
    const call = fakeJar.set.mock.calls.find(([name]) => name === CHECKOUT_INTENT_COOKIE);
    expect(call?.[2]).toMatchObject({ secure: false });
  });

  it("does not set the cookie and behaves exactly as before when a session exists", async () => {
    mocks.getCurrentActor.mockResolvedValue({ userId: "user-1", isStaff: false });
    mocks.startCheckout.mockResolvedValue({ orderId: "order-1" });

    await expect(enrollAction(enrollForm())).rejects.toThrow("redirect:/checkout/order-1");

    expect(fakeJar.set).not.toHaveBeenCalled();
    expect(mocks.startCheckout).toHaveBeenCalledWith(
      { userId: "user-1", isStaff: false },
      "clh3x9f9a0000356k2j5g8h2q",
      "NGN",
    );
  });

  it("redirects an already-enrolled learner instead of surfacing a generic error", async () => {
    mocks.getCurrentActor.mockResolvedValue({ userId: "user-1", isStaff: false });
    mocks.startCheckout.mockRejectedValue(new AlreadyEnrolledError("user-1", "cohort-1"));

    await expect(enrollAction(enrollForm())).rejects.toThrow("redirect:/courses");
  });

  it("redirects to /courses when currency is absent — never defaults to either rail (D-07)", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    const formWithNoCurrency = new FormData();
    formWithNoCurrency.set("cohortId", "clh3x9f9a0000356k2j5g8h2q");

    await expect(enrollAction(formWithNoCurrency)).rejects.toThrow("redirect:/courses");
    expect(fakeJar.set).not.toHaveBeenCalled();
  });

  it("redirects to /courses when currency is unsupported — never defaults to either rail (D-07)", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    await expect(enrollAction(enrollForm("clh3x9f9a0000356k2j5g8h2q", "GBP"))).rejects.toThrow(
      "redirect:/courses",
    );
    expect(fakeJar.set).not.toHaveBeenCalled();
  });
});

function signInForm(email = "learner@example.com", password = "password123") {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

describe("signInAction — consumes and clears the checkout-intent cookie", () => {
  it("redirects to the cohort's resumption path, with the currency carried through as a query parameter, when a dotted intent cookie is present", async () => {
    fakeJar.store.set(CHECKOUT_INTENT_COOKIE, { value: "clh3x9f9a0000356k2j5g8h2q.NGN" });
    mocks.signIn.mockResolvedValue({
      ok: true,
      token: "tok",
      expires: new Date(),
      isStaff: false,
    });

    await expect(
      signInAction({ error: null }, signInForm()),
    ).rejects.toThrow("redirect:/enrol/clh3x9f9a0000356k2j5g8h2q?currency=NGN");

    expect(fakeJar.delete).toHaveBeenCalledWith(CHECKOUT_INTENT_COOKIE);
  });

  it("redirects to /account when no intent cookie is present (pre-existing behaviour unchanged)", async () => {
    mocks.signIn.mockResolvedValue({
      ok: true,
      token: "tok",
      expires: new Date(),
      isStaff: false,
    });

    await expect(signInAction({ error: null }, signInForm())).rejects.toThrow(
      "redirect:/account",
    );
  });

  it("redirects to /staff/courses for staff, whatever the intent value, and still clears the cookie", async () => {
    fakeJar.store.set(CHECKOUT_INTENT_COOKIE, { value: "clh3x9f9a0000356k2j5g8h2q.NGN" });
    mocks.signIn.mockResolvedValue({
      ok: true,
      token: "tok",
      expires: new Date(),
      isStaff: true,
    });

    await expect(signInAction({ error: null }, signInForm())).rejects.toThrow(
      "redirect:/staff/courses",
    );

    expect(fakeJar.delete).toHaveBeenCalledWith(CHECKOUT_INTENT_COOKIE);
  });

  it("deletes the intent cookie on the same response that consumes it — a second unrelated sign-in does not restart checkout", async () => {
    fakeJar.store.set(CHECKOUT_INTENT_COOKIE, { value: "clh3x9f9a0000356k2j5g8h2q.NGN" });
    mocks.signIn.mockResolvedValue({
      ok: true,
      token: "tok-1",
      expires: new Date(),
      isStaff: false,
    });
    await expect(signInAction({ error: null }, signInForm())).rejects.toThrow(
      "redirect:/enrol/clh3x9f9a0000356k2j5g8h2q?currency=NGN",
    );
    expect(fakeJar.store.has(CHECKOUT_INTENT_COOKIE)).toBe(false);

    // A second, unrelated sign-in with no intent left behind lands on /account.
    mocks.signIn.mockResolvedValue({
      ok: true,
      token: "tok-2",
      expires: new Date(),
      isStaff: false,
    });
    await expect(signInAction({ error: null }, signInForm())).rejects.toThrow(
      "redirect:/account",
    );
  });

  it("leaves the intent cookie untouched on a failed sign-in, so the visitor can retry without losing their selection", async () => {
    fakeJar.store.set(CHECKOUT_INTENT_COOKIE, { value: "clh3x9f9a0000356k2j5g8h2q.NGN" });
    mocks.signIn.mockResolvedValue({ ok: false, reason: "INVALID" });

    const result = await signInAction({ error: null }, signInForm());

    expect(result.error).not.toBeNull();
    expect(fakeJar.delete).not.toHaveBeenCalled();
    expect(fakeJar.store.get(CHECKOUT_INTENT_COOKIE)?.value).toBe("clh3x9f9a0000356k2j5g8h2q.NGN");
  });

  it("session cookie is still set with the pre-existing flags alongside the intent handling", async () => {
    mocks.signIn.mockResolvedValue({
      ok: true,
      token: "tok",
      expires: new Date(),
      isStaff: false,
    });

    await expect(signInAction({ error: null }, signInForm())).rejects.toThrow(
      "redirect:/account",
    );

    expect(fakeJar.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      "tok",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
});
