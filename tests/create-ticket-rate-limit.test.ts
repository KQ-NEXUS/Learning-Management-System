/**
 * D-11 (plan 15-03, UI-SPEC S5) — new support requests are limited per
 * learner, not per device. A refused request creates no ticket; an invalid
 * submission is refused before the limiter and so consumes no attempt. The
 * form keeps what the learner wrote on any ok:false result (NewTicketForm only
 * clears on success), which the message tells them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getCurrentActor: vi.fn(),
  consume: vi.fn(),
  createOwnTicket: vi.fn(),
  validateLearnerTicketContext: vi.fn(),
}));

vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: m.getCurrentActor }));
vi.mock("@/server/services/rate-limit-service", () => ({ rateLimitService: { consume: m.consume } }));
vi.mock("@/server/services/ticket-service", () => ({ createOwnTicket: m.createOwnTicket }));
vi.mock("@/server/services/ticket-learner-context-service", () => ({
  parseLearnerContextHint: () => null,
  validateLearnerTicketContext: m.validateLearnerTicketContext,
}));

import { createTicketAction } from "@/app/(learner)/support/new/actions";

const VALID = {
  category: "TECHNICAL_PROBLEM" as const,
  subject: "Video will not play",
  message: "The lesson video stops after ten seconds every time.",
};

const S5 =
  "You've sent several requests in a short time. Wait 15 minutes, then send this one. What you wrote is still here.";

beforeEach(() => {
  vi.clearAllMocks();
  m.getCurrentActor.mockResolvedValue({ userId: "learner_1" });
  m.validateLearnerTicketContext.mockResolvedValue(null);
  m.createOwnTicket.mockResolvedValue({ reference: "T-0001", initialMessageId: "msg_1", version: 1 });
});

describe("createTicketAction — per-learner limit", () => {
  it("allows five requests in a window and refuses the sixth with the S5 message, creating no ticket", async () => {
    let count = 0;
    m.consume.mockImplementation(async () => {
      count += 1;
      return { limited: count > 5, windowMinutes: 15 };
    });

    for (let i = 0; i < 5; i += 1) {
      expect(await createTicketAction(VALID)).toMatchObject({ ok: true, reference: "T-0001" });
    }
    expect(m.createOwnTicket).toHaveBeenCalledTimes(5);

    expect(await createTicketAction(VALID)).toEqual({ ok: false, message: S5 });
    expect(m.createOwnTicket).toHaveBeenCalledTimes(5);
    expect(m.consume).toHaveBeenLastCalledWith("supportTicket", { ip: null, userId: "learner_1" });
  });

  it("a refusal carries no field errors and does not echo the ticket text", async () => {
    m.consume.mockResolvedValueOnce({ limited: true, windowMinutes: 15 });
    const result = await createTicketAction(VALID);
    expect(result).toEqual({ ok: false, message: S5 });
    expect(JSON.stringify(result)).not.toContain(VALID.message);
    expect(m.validateLearnerTicketContext).not.toHaveBeenCalled();
  });

  it("an invalid submission returns field errors and consumes no attempt", async () => {
    const result = await createTicketAction({ ...VALID, subject: "x" });
    expect(result).toMatchObject({ ok: false, fieldErrors: { subject: expect.any(String) } });
    expect(m.consume).not.toHaveBeenCalled();
    expect(m.createOwnTicket).not.toHaveBeenCalled();
  });

  it("a signed-out visitor is refused before the limiter", async () => {
    m.getCurrentActor.mockResolvedValueOnce(null);
    expect(await createTicketAction(VALID)).toEqual({ ok: false, message: "Sign in to continue." });
    expect(m.consume).not.toHaveBeenCalled();
  });

  it("a limiter failure collapses to the existing not-created message", async () => {
    m.consume.mockRejectedValueOnce(new Error("database down"));
    expect(await createTicketAction(VALID)).toEqual({
      ok: false,
      message: "Your ticket wasn’t created. Your text and selected files are still here.",
    });
    expect(m.createOwnTicket).not.toHaveBeenCalled();
  });
});
