import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ withdrawEnrolment: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/services/enrolment-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/enrolment-service")>();
  return { ...actual, withdrawEnrolment: m.withdrawEnrolment };
});

import { LiveCertificateError } from "@/server/services/enrolment-service";
import { withdrawEnrolmentAction } from "@/app/staff/cohorts/[id]/enrolment-actions";

beforeEach(() => vi.clearAllMocks());

describe("integration warning #4 — staff see why a withdrawal was refused", () => {
  it("shows the live-certificate message, naming the certificate", async () => {
    m.withdrawEnrolment.mockRejectedValueOnce(new LiveCertificateError("enr-1", "KQ-7F3A"));
    const result = await withdrawEnrolmentAction({
      cohortId: "cohort-1",
      enrolmentId: "enr-1",
      reason: "The learner failed the review.",
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain("KQ-7F3A");
    expect((result as { message: string }).message).toMatch(/revoke it/i);
  });
});
