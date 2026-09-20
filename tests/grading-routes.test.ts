import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ release: vi.fn(), summary: vi.fn(), queue: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/server/services/grading-service", () => ({ MAX_BATCH_RELEASE: 200, releaseGradesBatch: m.release, listCohortGradingSummary: m.summary, listGradingQueue: m.queue }));
import { AuthorizationError } from "@/server/permissions";
import { releaseGradesBatchAction } from "@/app/staff/cohorts/[id]/grading-actions";
beforeEach(() => { vi.clearAllMocks(); m.summary.mockResolvedValue([{ assessmentId: "a" }]); m.queue.mockResolvedValue([{ gradeId: "g1" }, { gradeId: "g2" }]); m.release.mockResolvedValue({ released: ["g1"], skipped: ["g2"] }); });
describe("batch release action", () => {
  it.each([[], Array(201).fill("g1")])("rejects invalid batch sizes before service reads", async gradeIds => { expect((await releaseGradesBatchAction({ cohortId: "c", gradeIds })).ok).toBe(false); expect(m.release).not.toHaveBeenCalled(); expect(m.summary).not.toHaveBeenCalled(); });
  it("calls release exactly once with all supplied IDs and revalidates", async () => { const result = await releaseGradesBatchAction({ cohortId: "c", gradeIds: ["g1", "g2"] }); expect(result).toEqual({ ok: true, released: ["g1"], skipped: ["g2"] }); expect(m.release).toHaveBeenCalledExactlyOnceWith({ gradeIds: ["g1", "g2"] }); expect(m.revalidate).toHaveBeenCalled(); });
  it("rejects cross-cohort grades before any release", async () => { expect((await releaseGradesBatchAction({ cohortId: "c", gradeIds: ["foreign"] })).ok).toBe(false); expect(m.release).not.toHaveBeenCalled(); });
  it("returns authorization denial as a form error", async () => { m.release.mockRejectedValue(new AuthorizationError("Denied" as never)); const result = await releaseGradesBatchAction({ cohortId: "c", gradeIds: ["g1"] }); expect(result.ok).toBe(false); expect(result).toHaveProperty("message"); });
});
