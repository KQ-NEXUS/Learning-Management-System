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

  const archived = status === "ARCHIVED";
  const published = status === "PUBLISHED";

  function settle(result: CatalogueActionResult | PublishActionResult, successText: string) {
    if (result.ok) {
      setFeedback({ tone: "success", text: successText });
      router.refresh();
      return true;
    }
    const text =
      result.reason === "COHORTS_RUNNING"
        ? `Blocked by running cohorts: ${cohortCodes(result)}.`
        : result.message;
    setFeedback({ tone: "danger", text });
    return false;
  }

  async function runListing(listed: boolean) {
    setBusy(listed ? "list" : "unlist");
    setFeedback(null);
    const result = await setListingAction({ courseId, listed });
    settle(result, listed ? "Course is now publicly listed." : "Course is no longer publicly listed.");
    setBusy(null);
  }

  async function runPublish(input: {
    migrateCohortIds: string[];
    reason: string | null;
    expectedUpdatedAt: string;
  }) {
    setBusy("publish");
    setPublishError(null);
    const result = await publishCourseAction({
      courseId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      reason: input.reason ?? undefined,
      migrateCohortIds: input.migrateCohortIds,
    });
    setBusy(null);
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
    const result = await action({ courseId, reason });
    setBusy(null);
    const ok = settle(
      result,
      kind === "unpublish"
        ? "Content unpublished — the course is back to draft."
        : kind === "archive"
          ? "Course archived and removed from the public catalogue."
          : "Course un-archived — it is back to draft and unlisted.",
    );
    if (ok) setModal(null);
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      {feedback && (
        <p
          role="alert"
          className={`px-3 py-2 text-xs ${
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
            className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90"
          >
            Publish content
          </button>
        )}
        {canPublishContent && published && (
          <button
            type="button"
            onClick={() => setModal("unpublish")}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Unpublish
          </button>
        )}

        {canManageListing && !archived && !publiclyListed && (
          <button
            type="button"
            disabled={busy === "list"}
            onClick={() => runListing(true)}
            className="border border-accent bg-white px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
          >
            List publicly
          </button>
        )}
        {canManageListing && !archived && publiclyListed && (
          <button
            type="button"
            disabled={busy === "unlist"}
            onClick={() => runListing(false)}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            Unlist
          </button>
        )}

        {!archived ? (
          <button
            type="button"
            onClick={() => setModal("archive")}
            className="border border-danger/40 bg-white px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-surface"
          >
            Archive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setModal("unarchive")}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Un-archive
          </button>
        )}

        <a
          href={`/staff/courses/${courseId}/arrange`}
          className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
        >
          Arrange
        </a>
        <a
          href={`/staff/courses/${courseId}/preview`}
          className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
        >
          Preview
        </a>
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
        onConfirm={(reason) => runReasoned("unarchive", reason)}
        onCancel={() => setModal(null)}
      />
    </div>
  );
}
