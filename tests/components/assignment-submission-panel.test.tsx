import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssignmentSubmissionPanel } from "@/components/learner/AssignmentSubmissionPanel";
import type { AssignmentSubmissionClientView } from "@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions";
import type { SubmissionReceipt } from "@/server/services/submission-service";

vi.mock("@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions", () => ({
  beginSubmissionUploadAction: vi.fn(),
  completeSubmissionUploadAction: vi.fn(),
  failSubmissionUploadAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Submission = AssignmentSubmissionClientView["submissions"][number];

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    submissionId: "sub1",
    receiptId: "receipt1",
    attemptNumber: 1,
    filename: "essay.pdf",
    sizeBytes: 1000,
    submittedAt: "2026-01-01T00:00:00.000Z",
    isLate: false,
    uploadStatus: "READY",
    ...overrides,
  };
}

/** The raw `SubmissionReceipt` shape (`submittedAt: Date`) — what
 *  `completeSubmissionUploadAction` actually resolves with, distinct from
 *  the client-shaped `Submission` (`submittedAt: string`) used for props. */
function receiptFixture(overrides: Partial<SubmissionReceipt> = {}): SubmissionReceipt {
  return {
    submissionId: "sub1",
    receiptId: "receipt1",
    attemptNumber: 1,
    filename: "essay.pdf",
    sizeBytes: 1000,
    submittedAt: new Date("2026-01-01T00:00:00.000Z"),
    isLate: false,
    uploadStatus: "READY",
    ...overrides,
  };
}

const base: AssignmentSubmissionClientView = {
  assessmentId: "a1",
  enrolmentId: "enr1",
  title: "Essay",
  instructions: "<p>Write an essay.</p>",
  dueAt: null,
  availableUntil: null,
  allowedFileTypes: ["pdf", "docx"],
  maxFileSizeBytes: 5_000_000,
  allowResubmission: false,
  submissions: [],
};

type ActionOverrides = Partial<
  Pick<ComponentProps<typeof AssignmentSubmissionPanel>, "onBegin" | "onComplete" | "onFail">
>;

function setup(
  overrides: Partial<AssignmentSubmissionClientView> = {},
  actions: ActionOverrides = {},
) {
  return render(
    <AssignmentSubmissionPanel
      {...base}
      {...overrides}
      onBegin={actions.onBegin}
      onComplete={actions.onComplete}
      onFail={actions.onFail}
    />,
  );
}

function selectFile(name = "essay.pdf", type = "application/pdf", size = 1000) {
  const file = new File(["x".repeat(size)], name, { type });
  fireEvent.change(screen.getByLabelText(/choose file/i), { target: { files: [file] } });
  return file;
}

function beginOk() {
  return vi.fn(async () => ({
    ok: true as const,
    submissionId: "sub1",
    uploadUrl: "https://storage.example/put",
    stagedKey: "submission-uploads/enr1/a1/opaque",
    attemptNumber: 1,
    isLate: false,
  }));
}

describe("AssignmentSubmissionPanel", () => {
  it("contains the native file input within the narrow submission card", () => {
    const { container } = setup();
    const input = container.querySelector('input[type="file"]');
    expect(input?.className).toContain("max-w-full");
    expect(input?.closest("label")?.className).toContain("max-w-full");
  });

  it("renders due and submission timestamps with the deterministic shared formatter", () => {
    setup({ dueAt: "2026-01-01T00:00:00.000Z", submissions: [submission()] });
    expect(screen.getAllByText("01/01/2026, 00:00:00")).toHaveLength(2);
  });

  it("renders the pre-submit instructions, file constraints and a muted (not danger) due date", () => {
    const { container } = setup({ dueAt: "2020-01-01T00:00:00.000Z" });

    expect(screen.getByText("Write an essay.")).toBeTruthy();
    expect(screen.getByText("pdf, docx")).toBeTruthy();
    expect(screen.getByText("4.8 MB")).toBeTruthy();
    expect(screen.getByText("Due")).toBeTruthy();

    const dueDt = screen.getByText("Due").closest("dt");
    expect(dueDt?.className ?? "").not.toMatch(/danger/);
    expect(container.innerHTML).not.toMatch(/text-danger/);
  });

  it("shows no late notice before dueAt and shows one with an enabled submit control after dueAt", () => {
    const future = new Date(Date.now() + 100_000).toISOString();
    const view = setup({ dueAt: future });
    selectFile();
    expect(screen.queryByText("This submission will be marked late")).toBeNull();
    view.unmount();

    const past = new Date(Date.now() - 100_000).toISOString();
    setup({ dueAt: past });
    selectFile();
    expect(screen.getByText("This submission will be marked late")).toBeTruthy();
    expect((screen.getByText("Submit assignment") as HTMLButtonElement).disabled).toBe(false);
  });

  it("replaces the submit control with the window-closed warning past availableUntil, rather than disabling it", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    setup({ availableUntil: past });

    expect(
      screen.getByText("The submission window for this assignment has closed."),
    ).toBeTruthy();
    expect(screen.queryByText("Submit assignment")).toBeNull();
    expect(screen.queryByLabelText(/choose file/i)).toBeNull();
  });

  it("calls begin, then PUTs to the returned url, then calls complete, in order, and shows the receipt only once complete resolves", async () => {
    const onBegin = beginOk();
    const putSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", putSpy);

    let resolveComplete!: (value: { ok: true; receipt: SubmissionReceipt }) => void;
    const completePromise = new Promise<{ ok: true; receipt: SubmissionReceipt }>((resolve) => {
      resolveComplete = resolve;
    });
    const onComplete = vi.fn(() => completePromise);
    const onFail = vi.fn();

    setup({}, { onBegin, onComplete, onFail });
    const file = selectFile();
    fireEvent.click(screen.getByText("Submit assignment"));

    await waitFor(() => expect(onBegin).toHaveBeenCalledTimes(1));
      expect(onBegin).toHaveBeenCalledWith({
        assessmentId: "a1",
        enrolmentId: "enr1",
      filename: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: file.size,
    });

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy.mock.calls[0][0]).toBe("https://storage.example/put");

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith({ submissionId: "sub1" });

    // Still pending — no receipt text anywhere yet.
    expect(screen.queryByText(/Submitted — receipt/)).toBeNull();

    const beginOrder = onBegin.mock.invocationCallOrder[0];
    const putOrder = putSpy.mock.invocationCallOrder[0];
    const completeOrder = onComplete.mock.invocationCallOrder[0];
    expect(beginOrder).toBeLessThan(putOrder);
    expect(putOrder).toBeLessThan(completeOrder);

    resolveComplete({
      ok: true,
      receipt: receiptFixture({ receiptId: "receipt-final" }),
    });

    await screen.findByText(/Submitted — receipt/);
    expect(screen.getByText("receipt-final")).toBeTruthy();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("renders the ASM-04 failure copy, calls the fail callback, resets the picker and shows no receipt on a rejected PUT", async () => {
    const onBegin = beginOk();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));
    const onFail = vi.fn(async () => ({ ok: true as const }));
    const onComplete = vi.fn();

    setup({}, { onBegin, onFail, onComplete });
    selectFile();
    fireEvent.click(screen.getByText("Submit assignment"));

    await screen.findByText("Your file couldn't be uploaded");
    expect(
      screen.getByText("Nothing was submitted. Check your connection and try again."),
    ).toBeTruthy();
    expect(onFail).toHaveBeenCalledWith({
      submissionId: "sub1",
      detail: "The storage upload failed.",
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByText(/Submitted — receipt/)).toBeNull();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("behaves identically on a rejected complete call", async () => {
    const onBegin = beginOk();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const onComplete = vi.fn(async () => ({
      ok: false as const,
      message: "Your file couldn't be uploaded",
      body: "Nothing was submitted. Check your connection and try again.",
    }));
    const onFail = vi.fn();

    setup({}, { onBegin, onComplete, onFail });
    selectFile();
    fireEvent.click(screen.getByText("Submit assignment"));

    await screen.findByText("Your file couldn't be uploaded");
    expect(
      screen.getByText("Nothing was submitted. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/Submitted — receipt/)).toBeNull();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("renders no Submit new version control when allowResubmission is false with an existing READY submission", () => {
    setup({ allowResubmission: false, submissions: [submission()] });

    expect(screen.queryByText("Submit new version")).toBeNull();
    expect(screen.queryByLabelText(/choose file/i)).toBeNull();
  });

  it("renders the full history newest first with two prior submissions, keeping the older receipt id present", () => {
    setup({
      allowResubmission: true,
      submissions: [
        submission({ submissionId: "sub1", receiptId: "receipt-old", attemptNumber: 1 }),
        submission({ submissionId: "sub2", receiptId: "receipt-new", attemptNumber: 2 }),
      ],
    });

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("receipt-new");
    expect(items[1].textContent).toContain("receipt-old");
    expect(screen.getByText("receipt-old")).toBeTruthy();
    expect(screen.getByText("Submit new version")).toBeTruthy();
  });

  it("renders a single prior submission as a list", () => {
    const { container } = setup({
      allowResubmission: true,
      submissions: [submission()],
    });

    expect(container.querySelector("ul")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
