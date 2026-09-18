import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CertificateQueueTable } from "@/app/staff/certificates/CertificateQueueTable";
import type { PendingIssuanceRow } from "@/server/services/certificate-service";

vi.mock("@/app/staff/certificates/certificate-actions", () => ({ issueCertificateAction: vi.fn() }));

afterEach(cleanup);

const rows: PendingIssuanceRow[] = [
  {
    enrolmentId: "e1",
    learnerName: "Ada",
    awardTitle: "Intro to Testing",
    awardType: "Course",
    eligibleSince: new Date("2026-01-01"),
    scope: "COURSE",
  },
  {
    enrolmentId: "e2",
    learnerName: "Grace",
    awardTitle: "Full Stack Programme",
    awardType: "Programme",
    eligibleSince: new Date("2026-01-02"),
    scope: "PROGRAMME",
  },
];

type IssueResult = { ok: true } | { ok: false; message: string };
function setup(
  rowsToRender = rows,
  onIssue: (input: unknown) => Promise<IssueResult> = vi.fn(async (_input: unknown) => ({ ok: true as const })),
) {
  return { ...render(<CertificateQueueTable rows={rowsToRender} onIssue={onIssue} />), onIssue };
}

describe("certificate pending-issuance queue", () => {
  it("renders the three columns, including plain-text Course/Programme type indicators", () => {
    setup();
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Intro to Testing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Course").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Full Stack Programme").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Programme").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issue certificate").length).toBeGreaterThan(0);
  });

  it("opens a reason-free confirmation with the exact UI-SPEC §6.1 copy", () => {
    setup();
    fireEvent.click(screen.getAllByText("Issue certificate")[0]);
    expect(screen.getByText("Issue this certificate?")).toBeTruthy();
    expect(
      screen.getByText(
        "Ada will be marked complete for Intro to Testing and can download their certificate immediately.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("removes the row from the queue immediately on a successful issue", async () => {
    const { onIssue } = setup();
    fireEvent.click(screen.getAllByText("Issue certificate")[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Issue certificate" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onIssue).toHaveBeenCalledExactlyOnceWith({ enrolmentId: "e1", scope: "COURSE" });
    expect(screen.queryByText("Intro to Testing")).toBeNull();
    expect(screen.getAllByText("Full Stack Programme").length).toBeGreaterThan(0);
  });

  it("renders the exact empty-state copy when nothing is awaiting issuance", () => {
    setup([]);
    expect(screen.getByText("Nothing awaiting issuance")).toBeTruthy();
    expect(
      screen.getByText(
        "Certificates will appear here once a learner completes a course or programme under manual issuance.",
      ),
    ).toBeTruthy();
  });

  it("surfaces a distinct, non-success message for an already-issued outcome", async () => {
    const onIssue = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      message: "A certificate for this enrolment already exists. Reload the queue to see it.",
    }));
    setup(rows, onIssue);
    fireEvent.click(screen.getAllByText("Issue certificate")[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Issue certificate" }));
    await waitFor(() =>
      expect(
        screen.getByText("A certificate for this enrolment already exists. Reload the queue to see it."),
      ).toBeTruthy(),
    );
    expect(screen.getAllByText("Intro to Testing").length).toBeGreaterThan(0);
  });

  it("surfaces a distinct, non-success message for a not-enabled outcome", async () => {
    const onIssue = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      message: "Certificates are no longer enabled for this course or programme. Reload the queue and try again.",
    }));
    setup(rows, onIssue);
    fireEvent.click(screen.getAllByText("Issue certificate")[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Issue certificate" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "Certificates are no longer enabled for this course or programme. Reload the queue and try again.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getAllByText("Intro to Testing").length).toBeGreaterThan(0);
  });

  it("surfaces a distinct, non-success message for a no-template outcome", async () => {
    const onIssue = vi.fn(async (_input: unknown) => ({
      ok: false as const,
      message:
        "No certificate template is configured for this course or programme yet. Add one under Certificate templates before issuing.",
    }));
    setup(rows, onIssue);
    fireEvent.click(screen.getAllByText("Issue certificate")[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Issue certificate" }));
    await waitFor(() =>
      expect(
        screen.getByText(
          "No certificate template is configured for this course or programme yet. Add one under Certificate templates before issuing.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getAllByText("Intro to Testing").length).toBeGreaterThan(0);
  });
});
