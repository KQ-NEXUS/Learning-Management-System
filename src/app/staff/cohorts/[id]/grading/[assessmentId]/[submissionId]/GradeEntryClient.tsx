"use client";

/**
 * The grade-entry screen's `"use client"` island (ASM-05, ASM-06, D-07,
 * `10-UI-SPEC.md` §7.2.4).
 *
 * Two mutually exclusive modes driven by the grade's `status`:
 *   - DRAFT (or no grade yet): an editable Score/Feedback panel with
 *     "Save draft" (always available) and "Release" (available once a
 *     score is entered). No override affordance renders here at all.
 *   - RELEASED: a read-only Score/Feedback fact display plus the single
 *     "Override grade" action. Save and Release are GONE.
 *
 * The two control sets are NEVER rendered together — leaving a Save button
 * beside an Override button would let a grader bypass D-07's mandatory-
 * reason path by simply re-saving over a released score
 * (`10-RESEARCH.md` Pitfall 5's exact warning sign).
 */

import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { ConfirmModal, FormField, StatusPill, TextInput } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";
import {
  saveDraftGradeAction,
  releaseGradeAction,
  overrideGradeAction,
} from "./actions";

export type OverrideHistoryRow = {
  previousScore: number;
  newScore: number;
  reason: string;
  actorName: string | null;
  /** ISO instant. */
  createdAt: string;
};

export type GradeEntryClientProps = {
  cohortId: string;
  assessmentId: string;
  submissionId: string;
  gradeId: string | null;
  status: "DRAFT" | "RELEASED" | null;
  score: number | null;
  feedback: string | null;
  /** `Assessment.totalMarks`, 0 when the assessment has none set. */
  maxScore: number;
  /** Newest first (§6.1). */
  overrides: OverrideHistoryRow[];
  saveDraft?: typeof saveDraftGradeAction;
  release?: typeof releaseGradeAction;
  override?: typeof overrideGradeAction;
};

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

/** Blank/non-integer/out-of-range all resolve to `null` — never silently
 * coerced to 0 (`Number("")` is `0` in JS, a real footgun for a blank
 * score field). */
function parseScore(raw: string, maxScore: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0 || value > maxScore) return null;
  return value;
}

export function GradeEntryClient({
  cohortId,
  assessmentId,
  submissionId,
  gradeId,
  status,
  score,
  feedback,
  maxScore,
  overrides,
  saveDraft = saveDraftGradeAction,
  release = releaseGradeAction,
  override = overrideGradeAction,
}: GradeEntryClientProps) {
  const released = status === "RELEASED";

  const [scoreInput, setScoreInput] = useState(score !== null ? String(score) : "");
  const [feedbackInput, setFeedbackInput] = useState(feedback ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [draftStatus, setDraftStatus] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideScoreInput, setOverrideScoreInput] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const parsedScore = parseScore(scoreInput, maxScore);
  const scoreEntered = parsedScore !== null;

  function handleSaveDraft() {
    setErrors([]);
    if (parsedScore === null) {
      setErrors([`Enter a whole-number score between 0 and ${maxScore}.`]);
      return;
    }
    startTransition(async () => {
      const result = await saveDraft({
        cohortId,
        assessmentId,
        submissionId,
        score: parsedScore,
        feedback: feedbackInput.trim() ? feedbackInput : null,
      });
      if (!result.ok) {
        setErrors([result.message]);
        return;
      }
      setDraftStatus(`Draft saved ${formatTimestamp(new Date(result.grade.gradedAt))}`);
    });
  }

  function handleRelease() {
    setErrors([]);
    if (parsedScore === null) {
      setErrors([`Enter a whole-number score between 0 and ${maxScore}.`]);
      return;
    }
    startTransition(async () => {
      // Release the values currently displayed, including edits to an existing draft.
      const saveResult = await saveDraft({
        cohortId,
        assessmentId,
        submissionId,
        score: parsedScore,
        feedback: feedbackInput.trim() ? feedbackInput : null,
      });
      if (!saveResult.ok) {
        setErrors([saveResult.message]);
        return;
      }
      const id = saveResult.grade.id;
      const result = await release({ cohortId, assessmentId, submissionId, gradeId: id });
      if (!result.ok) {
        setErrors([result.message]);
      }
    });
  }

  function openOverride() {
    setOverrideError(null);
    setOverrideScoreInput(score !== null ? String(score) : "");
    setOverrideOpen(true);
  }

  function confirmOverride(reason: string) {
    if (!gradeId) return; // unreachable — Override only renders once a RELEASED grade exists
    const newScore = parseScore(overrideScoreInput, maxScore);
    if (newScore === null) {
      setOverrideError(`Enter a whole-number score between 0 and ${maxScore}.`);
      return;
    }
    startTransition(async () => {
      const result = await override({ cohortId, assessmentId, submissionId, gradeId, newScore, reason });
      if (!result.ok) {
        setOverrideError(result.message);
        return;
      }
      setOverrideOpen(false);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold tracking-tight text-foreground">Score &amp; feedback</h3>
        <StatusPill tone={released ? "success" : "neutral"} label={released ? "Released" : "Draft"} />
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2">
          {errors.map((message, i) => (
            <p key={i} className="text-sm text-danger">
              {message}
            </p>
          ))}
        </div>
      )}

      {!released ? (
        <div className="flex flex-col gap-4">
          <FormField name="score" label="Score" hint={`out of ${maxScore}`}>
            {(fieldProps) => (
              <TextInput
                {...fieldProps}
                type="number"
                min={0}
                max={maxScore}
                value={scoreInput}
                disabled={pending}
                onChange={(e) => setScoreInput(e.target.value)}
              />
            )}
          </FormField>

          <FormField name="feedback" label="Feedback" hint="Visible to the learner once released.">
            {(fieldProps) => (
              <textarea
                {...fieldProps}
                rows={3}
                value={feedbackInput}
                disabled={pending}
                onChange={(e) => setFeedbackInput(e.target.value)}
                className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground disabled:bg-surface-2"
              />
            )}
          </FormField>

          {/*
            DRAFT-only zone — Save/Release, never Override. The RELEASED
            branch below renders Override only, never Save/Release. Showing
            both at once would let a grader bypass D-07's mandatory-reason
            override by just re-saving (10-RESEARCH.md Pitfall 5).
          */}
          <div className="flex flex-wrap items-center gap-4">
            {draftStatus && <p className="font-mono text-[11px] text-muted-foreground">{draftStatus}</p>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button type="button" className={BTN} disabled={pending} onClick={handleSaveDraft}>
                {pending ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={pending || !scoreEntered}
                onClick={handleRelease}
              >
                {pending ? "Releasing…" : "Release"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Score</dt>
              <dd className="font-mono text-sm tabular-nums text-foreground">
                {score ?? "—"} / {maxScore}
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Feedback</dt>
              <dd className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground">{feedback || "—"}</dd>
            </div>
          </dl>

          <p className="text-sm text-muted-foreground">
            Certificate impact — not yet evaluated (arriving in a future update)
          </p>

          {overrides.length > 0 && (
            <ul className="flex flex-col gap-2 border-t border-border pt-4">
              {overrides.map((o, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  Overridden from {o.previousScore} to {o.newScore} by {o.actorName ?? "Unknown"},{" "}
                  {formatTimestamp(new Date(o.createdAt))} — &ldquo;{o.reason}&rdquo;
                </li>
              ))}
            </ul>
          )}

          <div>
            <button type="button" className={BTN} onClick={openOverride}>
              <RotateCcw aria-hidden size={16} className="mr-2 inline-block align-text-bottom" />
              Override grade
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={overrideOpen}
        tone="default"
        title="Override grade"
        confirmLabel="Override grade"
        minReasonLength={10}
        pending={pending}
        error={overrideError}
        description={
          <div className="flex flex-col gap-3">
            <p>
              This grade has already been released to the learner. Overriding it requires a reason and
              will be recorded in the audit history.
            </p>
            <FormField name="override-score" label="New score" hint={`out of ${maxScore}`}>
              {(fieldProps) => (
                <TextInput
                  {...fieldProps}
                  type="number"
                  min={0}
                  max={maxScore}
                  value={overrideScoreInput}
                  disabled={pending}
                  onChange={(e) => setOverrideScoreInput(e.target.value)}
                />
              )}
            </FormField>
          </div>
        }
        onConfirm={confirmOverride}
        onCancel={() => {
          if (!pending) setOverrideOpen(false);
        }}
      />
    </div>
  );
}
