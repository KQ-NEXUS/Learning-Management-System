import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GradingQueueTable } from "@/app/staff/cohorts/[id]/grading/[assessmentId]/GradingQueueTable";
import type { GradingQueueRow } from "@/server/services/grading-service";
vi.mock("@/app/staff/cohorts/[id]/grading-actions", () => ({ releaseGradesBatchAction: vi.fn() }));
afterEach(cleanup);
const rows: GradingQueueRow[] = [
  { submissionId: "s1", enrolmentId: "e1", learnerName: "Ada", submittedAt: new Date("2026-01-01"), isLate: true, attemptNumber: 1, uploadStatus: "READY", gradeId: "g1", gradeStatus: "DRAFT", score: 4 },
  { submissionId: "s2", enrolmentId: "e2", learnerName: "Grace", submittedAt: new Date("2026-01-02"), isLate: false, attemptNumber: 1, uploadStatus: "READY", gradeId: "g2", gradeStatus: "RELEASED", score: 5 },
  { submissionId: "s3", enrolmentId: "e3", learnerName: "Lin", submittedAt: new Date("2026-01-03"), isLate: false, attemptNumber: 1, uploadStatus: "READY", gradeId: null, gradeStatus: null, score: null },
];
function setup(onRelease = vi.fn(async (_input: unknown) => ({ ok: true as const, released: ["g1"], skipped: ["g2"] }))) {
  return { ...render(<GradingQueueTable cohortId="c" assessmentId="a" rows={rows} onRelease={onRelease} />), onRelease };
}
function select(name: string) { fireEvent.click(screen.getAllByRole("checkbox", { name: `Select ${name}` })[0]); }
describe("grading queue", () => {
  it("renders late only where needed, mono timestamps, status and an ungraded dash", () => {
    const { container } = setup(); expect(screen.getAllByText("Late").length).toBeGreaterThan(0); expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0); expect(container.querySelector("td.font-mono")).toBeTruthy();
    expect(screen.getAllByText("01/01/2026, 00:00:00").length).toBeGreaterThan(0);
  });
  it("enables release only when at least one selected grade is draft", () => {
    setup(); select("Grace"); expect((screen.getByText("Release selected") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Select one or more draft submissions to release them together.")).toBeTruthy();
    select("Ada"); expect((screen.getByText("Release selected") as HTMLButtonElement).disabled).toBe(false);
  });
  it("confirms once with the whole selection, including released IDs, then clears it", async () => {
    const { onRelease } = setup(); select("Grace"); select("Ada"); fireEvent.click(screen.getByText("Release selected"));
    expect(screen.getByText("Release 2 grades")).toBeTruthy(); expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Release grades" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onRelease).toHaveBeenCalledExactlyOnceWith({ cohortId: "c", gradeIds: ["g1", "g2"] });
    expect(screen.queryByText("2 selected")).toBeNull(); expect(screen.getByText(/already released grades skipped/)).toBeTruthy();
  });
  it("keeps confirmation pending for the whole transaction", async () => {
    let finish!: (result: { ok: true; released: string[]; skipped: string[] }) => void;
    setup(vi.fn(async (_input: unknown) => new Promise(resolve => { finish = resolve; })));
    select("Ada"); fireEvent.click(screen.getByText("Release selected")); fireEvent.click(screen.getByRole("button", { name: "Release grades" }));
    expect(screen.getByRole("dialog")).toBeTruthy(); expect((screen.getByRole("button", { name: "Working…" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true, released: ["g1"], skipped: [] }); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("filters with the existing segmented status control", () => {
    setup(); fireEvent.click(screen.getByRole("button", { name: "Released" })); expect(screen.queryByText("Ada")).toBeNull(); expect(screen.getAllByText("Grace").length).toBeGreaterThan(0);
  });
});
