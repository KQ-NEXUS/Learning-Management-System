/**
 * The registration action echoes back the name and email a visitor typed when
 * it refuses a submit, so the form can show them again (audit R3-05: React
 * resets a form once its action settles). The password is never echoed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  registerLearner: vi.fn(),
  consume: vi.fn(),
  headers: new Headers({ "x-nf-client-connection-ip": "203.0.113.9" }),
}));
vi.mock("@/server/services/registration-service", () => ({
  registrationService: { registerLearner: m.registerLearner },
}));
vi.mock("@/server/services/rate-limit-service", () => ({
  rateLimitService: { consume: m.consume },
}));
vi.mock("next/headers", () => ({ headers: async () => m.headers }));

import { registerAction, type RegisterState } from "@/app/(auth)/register/actions";

const INITIAL: RegisterState = { error: null, sent: false };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = {
  name: "Ada Learner",
  email: "ada@example.test",
  password: "a-long-enough-password",
  acceptTerms: "on",
  acceptPrivacy: "on",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.registerLearner.mockResolvedValue({ ok: true });
  m.consume.mockResolvedValue({ limited: false, windowMinutes: 15 });
});

describe("registerAction", () => {
  it.each([
    ["a short password", { ...valid, password: "short" }],
    ["unaccepted terms", { ...valid, acceptTerms: "" }],
    ["a missing password", { ...valid, password: "" }],
  ])("refusing %s echoes the name and email, never the password, and counts the attempt", async (_case, fields) => {
    const state = await registerAction(INITIAL, form(fields));

    expect(state.sent).toBe(false);
    expect(state.error).toEqual(expect.any(String));
    expect(state.values).toEqual({ name: "Ada Learner", email: "ada@example.test" });
    expect(state.attempt).toBe(1);
    expect(JSON.stringify(state)).not.toContain(fields.password || "a-long-enough-password");
    expect(m.registerLearner).not.toHaveBeenCalled();

    const again = await registerAction(state, form(fields));
    expect(again.attempt).toBe(2);
  });

  it("echoes the values when the service itself refuses or throws", async () => {
    m.registerLearner.mockResolvedValueOnce({ ok: false, reason: "UNAVAILABLE" });
    expect((await registerAction(INITIAL, form(valid))).values).toEqual({ name: "Ada Learner", email: "ada@example.test" });

    m.registerLearner.mockRejectedValueOnce(new Error("database down"));
    const state = await registerAction(INITIAL, form(valid));
    expect(state).toMatchObject({ sent: false, values: { name: "Ada Learner", email: "ada@example.test" } });
  });

  it("a successful registration carries no echoed values, only the address the link was sent to", async () => {
    expect(await registerAction(INITIAL, form(valid))).toEqual({ error: null, sent: true, email: "ada@example.test" });
  });
});

describe("registerAction — D-11 per-device limit", () => {
  it("a limited device gets the S5 message with name and email echoed, never the password, and never reaches registration", async () => {
    m.consume.mockResolvedValueOnce({ limited: true, windowMinutes: 15 });

    const state = await registerAction(INITIAL, form(valid));

    expect(state).toEqual({
      error: "Too many sign-up attempts from this device. Wait 15 minutes, then try again.",
      sent: false,
      values: { name: "Ada Learner", email: "ada@example.test" },
      attempt: 1,
    });
    expect(JSON.stringify(state)).not.toContain(valid.password);
    expect(m.registerLearner).not.toHaveBeenCalled();
    expect(m.consume).toHaveBeenCalledWith("register", { ip: "203.0.113.9", email: "ada@example.test" });
  });

  it("an unlimited device registers exactly once", async () => {
    await registerAction(INITIAL, form(valid));
    expect(m.consume).toHaveBeenCalledTimes(1);
    expect(m.registerLearner).toHaveBeenCalledTimes(1);
  });

  it("an invalid submission is refused before the limiter, so it consumes nothing", async () => {
    await registerAction(INITIAL, form({ ...valid, password: "short" }));
    expect(m.consume).not.toHaveBeenCalled();
  });
});
