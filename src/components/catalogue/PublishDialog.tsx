"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReadinessItem } from "@/server/services/readiness-service";
import { ReadinessSummary } from "./ReadinessPanel";

/**
 * The publish confirmation (D-06).
 *
 * Cohort migration happens HERE and nowhere else. Every affected running Cohort
 * is listed with enough to decide by — its code, its learner count and its end
 * date — and every tick-box starts unticked. There is intentionally no bulk
 * tick control: D-06 is a per-Cohort decision, and a bulk control is exactly the
 * silent obligation change CAT-05 exists to prevent. A reason becomes mandatory
 * the moment any Cohort is ticked.
 *
 * The Publish button also disables while any blocking readiness item fails — but
 * that is a courtesy echo of the server gate, not the gate itself
 * (`publish-service` re-runs the evaluator, D-27).
 */

export type AffectedCohort = {
  id: string;
  code: string;
  title: string;
  endsAt: Date | string;
  enrolmentCount: number;
};

export type PublishDialogProps = {
  open: boolean;
  /** The server-evaluated readiness list (D-27) — the dialog never evaluates. */
  readinessItems: ReadinessItem[];
  /** From `getUnpublishedChangeSummary` — the obligation changes this publish would ship. */
  unpublishedChanges: string[];
  affectedCohorts: AffectedCohort[];
  /** The D-22 optimistic-concurrency token, as an ISO string. */
  expectedUpdatedAt: string;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onPublish: (input: {
    migrateCohortIds: string[];
    reason: string | null;
    expectedUpdatedAt: string;
  }) => void | Promise<void>;
};

const MIN_REASON = 10;

function formatEndDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PublishDialog(props: PublishDialogProps) {
  if (!props.open) return null;
  return <PublishDialogBody {...props} />;
}

function PublishDialogBody({
  readinessItems,
  unpublishedChanges,
  affectedCohorts,
  expectedUpdatedAt,
  pending = false,
  error = null,
  onCancel,
  onPublish,
}: PublishDialogProps) {
  const titleId = useId();
  const reasonId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");

  // Move focus into the dialog on open, and return it to whatever opened it on
  // close — the ConfirmModal precedent, so a keyboard user is never stranded on
  // the inert background.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    );
    (focusable && focusable.length > 0 ? focusable[0] : dialogRef.current)?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  // Escape while idle cancels; Tab wraps inside the dialog. Escape is suppressed
  // while a publish is in flight so a stray keypress cannot leave the user unsure
  // whether it applied.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onCancel]);

  const migrateCohortIds = useMemo(
    () => affectedCohorts.filter((cohort) => ticked[cohort.id]).map((cohort) => cohort.id),
    [affectedCohorts, ticked],
  );

  const blockingCount = readinessItems.filter(
    (item) => item.blocking && item.state === "FAIL",
  ).length;
  const reasonRequired = migrateCohortIds.length > 0;
  const reasonValid = !reasonRequired || reason.trim().length >= MIN_REASON;
  const canPublish = blockingCount === 0 && reasonValid && !pending;

  function toggle(id: string) {
    // Cohort selection is frozen while a publish is in flight — the submitted
    // payload must match exactly what the user confirmed.
    if (pending) return;
    setTicked((current) => ({ ...current, [id]: !current[id] }));
  }

  function submit() {
    if (!canPublish) return;
    onPublish({
      migrateCohortIds,
      reason: reason.trim() === "" ? null : reason.trim(),
      expectedUpdatedAt,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Publish content
          </span>
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            Publish this course
          </h2>
          <ReadinessSummary items={readinessItems} />
        </div>

        {blockingCount > 0 && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
            {blockingCount} blocking {blockingCount === 1 ? "item" : "items"} must be cleared before this
            course can be published.
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-danger">
              Not published
            </p>
            <p className="mt-0.5 text-sm text-danger">{error}</p>
          </div>
        )}

        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Changes this will publish
          </h3>
          {unpublishedChanges.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No obligation changes since the last publication — this re-publishes the current content.
            </p>
          ) : (
            <ul className="list-disc break-words pl-5 text-sm text-foreground">
              {unpublishedChanges.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Running cohorts on this course
          </h3>
          {affectedCohorts.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No running cohorts — this publish affects new bookings only.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Tick a cohort to move its learners onto the new version. Left unticked, it keeps the
                version it was pinned to.
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-2 font-semibold">Migrate</th>
                    <th className="py-1.5 pr-2 font-semibold">Code</th>
                    <th className="py-1.5 pr-2 font-semibold">Learners</th>
                    <th className="py-1.5 font-semibold">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {affectedCohorts.map((cohort) => {
                    const boxId = `${reasonId}-${cohort.id}`;
                    return (
                      <tr key={cohort.id} className="border-b border-border">
                        <td className="py-2 pr-2">
                          <input
                            id={boxId}
                            type="checkbox"
                            className="size-4 disabled:cursor-not-allowed disabled:opacity-50"
                            checked={Boolean(ticked[cohort.id])}
                            disabled={pending}
                            onChange={() => toggle(cohort.id)}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <label htmlFor={boxId} className="font-semibold">
                            {cohort.code}
                          </label>
                          <span className="block break-words text-xs text-muted-foreground">{cohort.title}</span>
                        </td>
                        <td className="py-2 pr-2 tabular-nums">{cohort.enrolmentCount}</td>
                        <td className="py-2 tabular-nums">{formatEndDate(cohort.endsAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={reasonId}
            className="text-[11px] font-semibold uppercase tracking-wide text-foreground"
          >
            Reason
            {reasonRequired && (
              <span className="ml-1 font-normal text-muted-foreground" aria-hidden>
                required
              </span>
            )}
          </label>
          <textarea
            id={reasonId}
            rows={3}
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={reasonRequired && !reasonValid ? true : undefined}
            className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-sm aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface-2"
            placeholder={
              reasonRequired
                ? "Why are these cohorts moving to the new version?"
                : "Optional unless you migrate a cohort"
            }
          />
          {reasonRequired && (
            <p
              aria-live="polite"
              className={`font-mono text-[11px] ${reasonValid ? "text-muted-foreground" : "text-danger"}`}
            >
              {reason.trim().length} / {MIN_REASON} minimum
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            type="button"
            disabled={!canPublish}
            onClick={submit}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Publishing…" : "Publish"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-input-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
