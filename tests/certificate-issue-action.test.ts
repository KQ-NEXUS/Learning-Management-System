/**
 * Plan 11-25: `issueCertificateAction` maps every non-`issued` service outcome to a fixed,
 * distinct, actionable message (T-11-38 / T-11-66 / T-11-105) — never raw error text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ issue: vi.fn(), revalidatePath: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/services/certificate-service", () => ({
  issueCertificateManually: mocks.issue,
}));

import { issueCertificateAction } from "@/app/staff/certificates/certificate-actions";

const input = { enrolmentId: "enr-1", scope: "COURSE" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issueCertificateAction outcome messages", () => {
  it("maps not-eligible to a fixed 'no longer active' message, revalidates the queue, and returns ok: false (CR-03)", async () => {
    mocks.issue.mockResolvedValue({ kind: "not-eligible" });

    const result = await issueCertificateAction(input);

    expect(result).toEqual({
      ok: false,
      message:
        "This learner's enrolment is no longer active, so a certificate cannot be issued. Reload the queue to see the current list.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/certificates");
  });

  it("returns an ok result and revalidates for an issued outcome", async () => {
    mocks.issue.mockResolvedValue({ kind: "issued", certificateId: "c1", verificationRef: "R1" });
    expect(await issueCertificateAction(input)).toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/certificates");
  });

  it("never passes raw error text through", async () => {
    mocks.issue.mockRejectedValue(new Error("SECRET internal detail"));
    const result = await issueCertificateAction(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});
