"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/primitives";
import type { ReadinessItem } from "@/server/services/readiness-service";
import {
  archiveCourseAction,
  publishCourseAction,
  setListingAction,
  unarchiveCourseAction,
  unpublishCourseAction,
  type CatalogueActionResult,
  type PublishActionResult,
} from "@/app/staff/courses/[id]/publish-actions";
import { PublishDialog, type AffectedCohort } from "./PublishDialog";

/**
 * The course detail action bar.
 *
 * Content publish and public listing are TWO controls under TWO permissions —
 * `courses.publish` gates Publish / Unpublish, `programmes.publish` gates
 * List publicly / Unlist — never one combined "go live" button (D-08 / D-09).
 * A control the viewer cannot use is hidden, but that is a courtesy: every
 * matching Server Action re-checks the permission and refuses regardless
 * (T-04-53). Archive and Un-archive capture a mandatory reason.
 */

export type CourseDetailActionsProps = {
  courseId: string;
  status: string;
  publiclyListed: boolean;
  /** Viewer holds `courses.publish`. */
  canPublishContent: boolean;
  /** Viewer holds `programmes.publish` (the listing permission). */
  canManageListing: boolean;
  expectedUpdatedAt: string;
  readinessItems: ReadinessItem[];
  unpublishedChanges: string[];
  affectedCohorts: AffectedCohort[];
};

type Feedback = { tone: "success" | "danger"; text: string } | null;

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
// Accent / danger secondaries — their own strings, not `${BTN} text-accent`, so the
// colour isn't left to Tailwind source order against BTN's own `text-foreground`
// / `border-input-border` (which wins, leaving the button ink-coloured).
const BTN_ACCENT =
  "rounded-md border border-accent bg-surface px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER =
  "rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50";

function cohortCodes(result: Extract<CatalogueActionResult, { reason: "COHORTS_RUNNING" }>): string {
  return result.cohorts.map((cohort) => cohort.code).join(", ");
}

export function CourseDetailActions({
  courseId,
  status,
  publiclyListed,
  canPublishContent,
  canManageListing,
  expectedUpdatedAt,
  readinessItems,
  unpublishedChanges,
  affectedCohorts,
}: CourseDetailActionsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [modal, setModal] = useState<null | "unpublish" | "archive" | "unarchive">(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const archived = status === "ARCHIVED";
  const published = status === "PUBLISHED";

  function failureText(result: Extract<CatalogueActionResult | PublishActionResult, { ok: false }>) {
    if (result.reason === "COHORTS_RUNNING") {
      return `Blocked by running cohorts: ${cohortCodes(result)}.`;
    }
    if (result.reason === "NOT_READY" && result.failures.length > 0) {
      return `${result.message} Blocking: ${result.failures.map((item) => item.label).join(", ")}.`;
    }
    return result.message;
  }

  function settle(result: CatalogueActionResult | PublishActionResult, successText: string) {
    if (result.ok) {
      setFeedback({ tone: "success", text: successText });
      router.refresh();
      return true;
    }
    setFeedback({ tone: "danger", text: failureText(result) });
    return false;
  }

  function openModal(kind: "unpublish" | "archive" | "unarchive") {
    setModalError(null);
    setFeedback(null);
    setModal(kind);
  }

  async function runListing(listed: boolean) {
    setBusy(listed ? "list" : "unlist");
    setFeedback(null);
    try {
      const result = await setListingAction({ courseId, listed });
      settle(result, listed ? "Course is now publicly listed." : "Course is no longer publicly listed.");
    } catch {
      // An unexpected rejection (transport/server fault) — never a silent
      // success, never a raw exception on screen, and the control must not
      // stay stuck disabled. `finally` clears busy so the user can retry.
      setFeedback({
        tone: "danger",
        text: "Something went wrong and the listing change was not applied. Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function runPublish(input: {
    migrateCohortIds: string[];
    reason: string | null;
    expectedUpdatedAt: string;
  }) {
    setBusy("publish");
    setPublishError(null);
    try {
      const result = await publishCourseAction({
        courseId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        reason: input.reason ?? undefined,
        migrateCohortIds: input.migrateCohortIds,
      });
      if (result.ok) {
        setPublishOpen(false);
        const migrated = result.migratedCohortIds.length;
        settle(result, migrated > 0 ? `Published. ${migrated} cohort(s) migrated.` : "Course published.");
        return;
      }
      setPublishError(
        result.reason === "COHORTS_RUNNING"
          ? `Blocked by running cohorts: ${cohortCodes(result)}.`
          : result.message,
      );
    } catch {
      // A rejected publish is not a publish. Keep the dialog, the ticked
      // cohorts and the typed reason so the user can retry deliberately —
      // never auto-repeat the mutation.
      setPublishError(
        "Something went wrong and the course was not published. Your selections are still here — try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function runReasoned(
    kind: "unpublish" | "archive" | "unarchive",
    reason: string,
  ) {
    setBusy(kind);
    const action =
      kind === "unpublish"
        ? unpublishCourseAction
        : kind === "archive"
          ? archiveCourseAction
          : unarchiveCourseAction;
    let result: CatalogueActionResult;
    try {
      result = await action({ courseId, reason });
    } catch {
      // Keep the modal and the typed reason so a retry is one click away.
      setModalError("Something went wrong and the action was not applied. Please try again.");
      return;
    } finally {
      setBusy(null);
    }
    if (result.ok) {
      const warnings =
        kind === "archive" && "programmeWarnings" in result && result.programmeWarnings?.length
          ? ` It was removed from the draft order of: ${result.programmeWarnings.join(", ")} (published versions are unchanged).`
          : "";
      settle(
        result,
        (kind === "unpublish"
          ? "Content unpublished — the course is back to draft."
          : kind === "archive"
            ? "Course archived and removed from the public catalogue."
            : "Course un-archived — it is back to draft and unlisted.") + warnings,
      );
      setModal(null);
      return;
    }
    // Keep the modal open and show the refusal in it — a COHORTS_RUNNING
    // message names the blocking cohorts and must not hide behind the dialog.
    setModalError(failureText(result));
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      {feedback && (
        <p
          role="alert"
          className={`rounded-md px-4 py-2 text-sm ${
            feedback.tone === "success"
              ? "border border-success/30 bg-success/10 text-success"
              : "border border-danger/30 bg-danger-surface text-danger"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canPublishContent && !archived && (
          <button
            type="button"
            onClick={() => {
              setPublishError(null);
              setPublishOpen(true);
            }}
            className={BTN_PRIMARY}
          >
            Publish content
          </button>
        )}
        {canPublishContent && published && (
          <button
            type="button"
            onClick={() => openModal("unpublish")}
            className={BTN}
          >
            Unpublish
          </button>
        )}

        {canManageListing && !archived && !publiclyListed && (
          <button
            type="button"
            disabled={busy === "list"}
            onClick={() => runListing(true)}
            className={BTN_ACCENT}
          >
            List publicly
          </button>
        )}
        {canManageListing && !archived && publiclyListed && (
          <button
            type="button"
            disabled={busy === "unlist"}
            onClick={() => runListing(false)}
            className={BTN}
          >
            Unlist
          </button>
        )}

        {!archived ? (
          <button
            type="button"
            onClick={() => openModal("archive")}
            className={BTN_DANGER}
          >
            Archive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => openModal("unarchive")}
            className={BTN}
          >
            Un-archive
          </button>
        )}

        <a
          href={`/staff/courses/${courseId}/arrange`}
          className={BTN}
        >
          Arrange
        </a>
        {/* The preview links live on the course detail page itself (plan 04-14). */}
      </div>

      <PublishDialog
        open={publishOpen}
        readinessItems={readinessItems}
        unpublishedChanges={unpublishedChanges}
        affectedCohorts={affectedCohorts}
        expectedUpdatedAt={expectedUpdatedAt}
        pending={busy === "publish"}
        error={publishError}
        onCancel={() => setPublishOpen(false)}
        onPublish={runPublish}
      />

      <ConfirmModal
        open={modal === "unpublish"}
        title="Unpublish this course's content"
        description="Learners on running cohorts keep the version they were pinned to. New bookings get nothing until you publish again."
        confirmLabel="Unpublish"
        minReasonLength={10}
        reasonLabel="Reason for unpublishing"
        pending={busy === "unpublish"}
        error={modal === "unpublish" ? modalError : null}
        onConfirm={(reason) => runReasoned("unpublish", reason)}
        onCancel={() => setModal(null)}
      />
      <ConfirmModal
        open={modal === "archive"}
        title="Archive this course"
        description="It leaves the public catalogue immediately. It cannot be archived while a cohort is running."
        confirmLabel="Archive course"
        minReasonLength={10}
        reasonLabel="Reason for archiving"
        pending={busy === "archive"}
        error={modal === "archive" ? modalError : null}
        onConfirm={(reason) => runReasoned("archive", reason)}
        onCancel={() => setModal(null)}
      />
      <ConfirmModal
        open={modal === "unarchive"}
        title="Un-archive this course"
        description="It returns to draft and stays unlisted — publishing and listing it again are separate, deliberate steps."
        confirmLabel="Un-archive"
        minReasonLength={10}
        reasonLabel="Reason for un-archiving"
        pending={busy === "unarchive"}
        error={modal === "unarchive" ? modalError : null}
        onConfirm={(reason) => runReasoned("unarchive", reason)}
        onCancel={() => setModal(null)}
      />
    </div>
  );
}
