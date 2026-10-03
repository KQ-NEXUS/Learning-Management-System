/**
 * The registration action echoes back the name and email a visitor typed when
 * it refuses a submit, so the form can show them again (audit R3-05: React
 * resets a form once its action settles). The password is never echoed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ registerLearner: vi.fn() }));
vi.mock("@/server/services/registration-service", () => ({
  registrationService: { registerLearner: m.registerLearner },
}));

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
