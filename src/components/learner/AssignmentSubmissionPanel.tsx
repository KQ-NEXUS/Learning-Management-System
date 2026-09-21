"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, ClipboardList, Clock, FileCheck, Upload } from "lucide-react";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { AssignmentSubmissionClientView } from "@/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions";
import {
  beginSubmissionUploadAction,
  completeSubmissionUploadAction,
  failSubmissionUploadAction,
} from "@/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/submission-actions";

/**
 * The Assignment submission pane (ASM-03, ASM-04, D-03, D-04, 10-14 Task 2)
 * — a sibling client island beside `LessonContent`, following the exact
 * shape `QuizAttemptPanel` (plan 10-11) already established for this same
 * slot.
 *
 * State machine (§7.4 of `10-UI-SPEC.md`):
 *   pre-submit -> uploading -> receipt (+ history)
 *                          \-> failure -> pre-submit (retry, same file)
 *   hard cutoff (`availableUntil` passed) REPLACES the submit control at
 *   any point in this machine — never merely disables it.
 *
 * T-10-19 (Repudiation — false-success receipt): `submissions` only ever
 * gains a new entry inside the `completeSubmissionUploadAction` success
 * branch below. The begin step's reply carries no `receiptId` at all (its
 * type has none), so an optimistic "it's probably fine" render is not even
 * constructible from what `beginSubmissionUploadAction` returns — the only
 * path to a receipt on screen is a verified `complete` call.
 *
 * T-10-34 (XSS — authored instructions HTML): `instructions` arrives
 * already sanitised by `sanitizeLessonBody` inside
 * `submission-actions.ts`'s `loadAssignmentSubmissionView` (the same
 * allow-list `LessonContent`'s `BodyProse` uses) — this component never
 * re-implements or weakens that pass, it only renders the already-safe
 * string.
 */

type SubmissionRow = AssignmentSubmissionClientView["submissions"][number];

type Props = AssignmentSubmissionClientView & {
  onBegin?: typeof beginSubmissionUploadAction;
  onComplete?: typeof completeSubmissionUploadAction;
  onFail?: typeof failSubmissionUploadAction;
};

const BUTTON =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50";

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** One receipt row — rendered for every READY submission, newest first, never collapsed to a singular/plural branch (§8 zero-one-many). */
function SubmissionHistoryRow({ submission }: { submission: SubmissionRow }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-4 py-3 text-sm">
      <FileCheck aria-hidden size={16} className="shrink-0 text-success" />
      <span className="font-semibold">
        Submitted — receipt <span className="font-mono">{submission.receiptId}</span>
      </span>
      <StatusPill tone="success" label="Submitted" />
      {submission.isLate && <StatusPill tone="warning" label="Late" />}
      <span className="text-muted-foreground">{submission.filename}</span>
      <span className="font-mono text-muted-foreground">{humanSize(submission.sizeBytes)}</span>
      <span className="font-mono text-muted-foreground">
        {formatTimestamp(new Date(submission.submittedAt))}
      </span>
    </li>
  );
}

/** §7.4.4 — the ASM-04 failure copy, verbatim, with a retry CTA that re-attempts the SAME selected file (never asks the learner to re-pick after a transient network failure). */
function UploadFailureNotice({
  error,
  pending,
  onRetry,
}: {
  error: { message: string; body?: string };
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger">
      <p className="font-semibold">{error.message}</p>
      {error.body && <p>{error.body}</p>}
      <button type="button" disabled={pending} onClick={onRetry} className={BUTTON}>
        Try again
      </button>
    </div>
  );
}

export function AssignmentSubmissionPanel(props: Props) {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>(props.submissions);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<{ message: string; body?: string } | null>(null);
  const [pending, transition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The same "recompute lateness/cutoff reactively" clock QuizAttemptPanel
  // already runs — a learner who leaves this tab open past `dueAt`/
  // `availableUntil` sees the notice appear without a manual refresh.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const readySubmissions = submissions
    .filter((s) => s.uploadStatus === "READY")
    .slice()
    .sort((a, b) => b.attemptNumber - a.attemptNumber);

  const closed = props.availableUntil != null && now >= new Date(props.availableUntil).getTime();
  const isLateSelection =
    selectedFile != null && props.dueAt != null && now > new Date(props.dueAt).getTime();

  // The picker starts open when there is nothing verified yet, and closes
  // again after a fresh verified upload (D-04) — reopened only through the
  // explicit "Submit new version" control, never automatically.
  const [showPicker, setShowPicker] = useState(readySubmissions.length === 0);

  function chooseFile(file: File | null) {
    setError(null);
    setSelectedFile(file);
  }

  async function upload() {
    if (!selectedFile) return;
    setError(null);

    transition(async () => {
      const begin = await (props.onBegin ?? beginSubmissionUploadAction)({
        assessmentId: props.assessmentId,
        enrolmentId: props.enrolmentId,
        filename: selectedFile.name,
        mimeType: selectedFile.type,
        sizeBytes: selectedFile.size,
      });
      if (!begin.ok) {
        setError(begin);
        return;
      }

      // Direct browser -> object-store PUT — the file body never traverses
      // this app's server (the threat model's second trust boundary).
      let putFailed = false;
      try {
        const put = await fetch(begin.uploadUrl, {
          method: "PUT",
          headers: { "content-type": selectedFile.type },
          body: selectedFile,
        });
        if (!put.ok) putFailed = true;
      } catch {
        putFailed = true;
      }

      if (putFailed) {
        await (props.onFail ?? failSubmissionUploadAction)({
          submissionId: begin.submissionId,
          detail: "The storage upload failed.",
        });
        setError({
          message: "Your file couldn't be uploaded",
          body: "Nothing was submitted. Check your connection and try again.",
        });
        return;
      }

      const complete = await (props.onComplete ?? completeSubmissionUploadAction)({
        submissionId: begin.submissionId,
      });
      if (!complete.ok) {
        setError(complete);
        return;
      }

      // The ONLY place a receipt enters state — after a verified `complete`.
      const receipt = complete.receipt;
      setSubmissions((old) => [
        ...old.filter((s) => s.submissionId !== receipt.submissionId),
        {
          submissionId: receipt.submissionId,
          receiptId: receipt.receiptId,
          attemptNumber: receipt.attemptNumber,
          filename: receipt.filename,
          sizeBytes: receipt.sizeBytes,
          submittedAt: new Date(receipt.submittedAt).toISOString(),
          isLate: receipt.isLate,
          uploadStatus: receipt.uploadStatus,
        },
      ]);
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setShowPicker(false);
    });
  }

  return (
    <section
      className="flex flex-col gap-4 border-t border-foreground pt-5"
      aria-label="Assignment submission"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ClipboardList aria-hidden size={20} />
        {props.title}
      </h2>

      {props.instructions && (
        <div
          className="prose-sm max-w-prose [&_a]:text-accent [&_a]:underline"
          // Already sanitised server-side by `loadAssignmentSubmissionView`
          // (same `sanitizeLessonBody` allow-list `BodyProse` uses) — no
          // second, weaker rendering path is introduced here.
          dangerouslySetInnerHTML={{ __html: props.instructions }}
        />
      )}

      <dl className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        {props.dueAt && (
          <div>
            {/* Muted, never `--danger` — D-03 makes the due date informational only, even once it has passed. */}
            <dt className="flex items-center gap-1">
              <Clock aria-hidden size={16} />
              Due
            </dt>
            <dd className="font-mono">{formatTimestamp(new Date(props.dueAt))}</dd>
          </div>
        )}
        <div>
          <dt>Accepted file types</dt>
          <dd>{props.allowedFileTypes.length > 0 ? props.allowedFileTypes.join(", ") : "Any"}</dd>
        </div>
        {props.maxFileSizeBytes != null && (
          <div>
            <dt>Maximum size</dt>
            <dd>{humanSize(props.maxFileSizeBytes)}</dd>
          </div>
        )}
      </dl>

      {readySubmissions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Submission history</h3>
          <ul className="flex flex-col gap-2">
            {readySubmissions.map((submission) => (
              <SubmissionHistoryRow key={submission.submissionId} submission={submission} />
            ))}
          </ul>
        </div>
      )}

      {closed ? (
        // §7.4.2 — REPLACES the submit control entirely, never disables it.
        <p className="flex items-center gap-2 text-sm text-warning">
          <AlertTriangle aria-hidden size={20} />
          The submission window for this assignment has closed.
        </p>
      ) : showPicker ? (
        <div className="flex flex-col items-start gap-3">
          <label className="flex max-w-full flex-col gap-2 rounded-md border border-dashed border-input-border bg-surface-2 p-4 text-sm font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <Upload aria-hidden className="size-4 text-accent" />
              Choose file
            </span>
            <input
              ref={inputRef}
              type="file"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              className="max-w-full min-w-0 text-sm file:mr-4 file:rounded-md file:border file:border-input-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold"
            />
          </label>
          {isLateSelection && (
            <p className="text-sm text-warning">This submission will be marked late</p>
          )}
          <button
            type="button"
            disabled={!selectedFile || pending}
            onClick={() => void upload()}
            className={BUTTON}
          >
            {pending ? "Submitting…" : "Submit assignment"}
          </button>
        </div>
      ) : props.allowResubmission ? (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="w-fit text-sm font-semibold text-accent"
        >
          Submit new version
        </button>
      ) : null}

      {error && <UploadFailureNotice error={error} pending={pending} onRetry={() => void upload()} />}
    </section>
  );
}
