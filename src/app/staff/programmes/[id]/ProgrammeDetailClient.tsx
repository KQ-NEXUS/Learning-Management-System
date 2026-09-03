"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/primitives";
import { PublishDialog, type AffectedCohort } from "@/components/catalogue/PublishDialog";
import type { ReadinessItem } from "@/server/services/readiness-service";
import {
  archiveProgrammeAction,
  publishProgrammeAction,
  setProgrammeListingAction,
  unarchiveProgrammeAction,
  unpublishProgrammeAction,
  type CatalogueActionResult,
  type PublishActionResult,
} from "./publish-actions";

/**
 * The Programme action bar + publish dialog — the Programme mirror of
 * `CourseDetailActions`. Content publish and public listing are both
 * `programmes.publish`; archive / un-archive are `programmes.manage`. A hidden
 * control is a courtesy; every Server Action re-checks and refuses (T-04-59).
 */

export type ProgrammeDetailClientProps = {
  programmeId: string;
  status: string;
  publiclyListed: boolean;
  /** Viewer holds `programmes.publish`. */
  canPublish: boolean;
  /** Viewer holds `programmes.manage` (archive / un-archive). */
  canManage: boolean;
  expectedUpdatedAt: string;
  readinessItems: ReadinessItem[];
  unpublishedChanges: string[];
  affectedCohorts: AffectedCohort[];
};

type Feedback = { tone: "success" | "danger"; text: string } | null;

function failureText(result: Extract<CatalogueActionResult | PublishActionResult, { ok: false }>) {
  if (result.reason === "COHORTS_RUNNING") {
    return `Blocked by running cohorts: ${result.cohorts.map((c) => c.code).join(", ")}.`;
  }
  if (result.reason === "NOT_READY" && result.failures.length > 0) {
    return `${result.message} Blocking: ${result.failures.map((i) => i.label).join(", ")}.`;
  }
  return result.message;
}

export function ProgrammeDetailClient({
  programmeId,
  status,
  publiclyListed,
  canPublish,
  canManage,
  expectedUpdatedAt,
  readinessItems,
  unpublishedChanges,
  affectedCohorts,
}: ProgrammeDetailClientProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "unpublish" | "archive" | "unarchive">(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const archived = status === "ARCHIVED";
  const published = status === "PUBLISHED";

  function settle(result: CatalogueActionResult | PublishActionResult, ok: string) {
    if (result.ok) {
      setFeedback({ tone: "success", text: ok });
      router.refresh();
      return true;
    }
    setFeedback({ tone: "danger", text: failureText(result) });
    return false;
  }

  async function runListing(listed: boolean) {
    setBusy(listed ? "list" : "unlist");
    setFeedback(null);
    settle(
      await setProgrammeListingAction({ programmeId, listed }),
      listed ? "Programme is now publicly listed." : "Programme is no longer publicly listed.",
    );
    setBusy(null);
  }

  async function runPublish(input: {
    migrateCohortIds: string[];
    reason: string | null;
    expectedUpdatedAt: string;
  }) {
    setBusy("publish");
    setPublishError(null);
    const result = await publishProgrammeAction({
      programmeId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      reason: input.reason ?? undefined,
      migrateCohortIds: input.migrateCohortIds,
    });
    setBusy(null);
    if (result.ok) {
      setPublishOpen(false);
      const migrated = result.migratedCohortIds.length;
      settle(result, migrated > 0 ? `Published. ${migrated} cohort(s) migrated.` : "Programme published.");
      return;
    }
    setPublishError(failureText(result));
  }

  async function runReasoned(kind: "unpublish" | "archive" | "unarchive", reason: string) {
    setBusy(kind);
    const action =
      kind === "unpublish"
        ? unpublishProgrammeAction
        : kind === "archive"
          ? archiveProgrammeAction
          : unarchiveProgrammeAction;
    const result = await action({ programmeId, reason });
    setBusy(null);
    if (result.ok) {
      settle(
        result,
        kind === "unpublish"
          ? "Content unpublished — the programme is back to draft."
          : kind === "archive"
            ? "Programme archived and removed from the public catalogue."
            : "Programme un-archived — it is back to draft and unlisted.",
      );
      setModal(null);
      return;
    }
    setModalError(failureText(result));
  }

  function openModal(kind: "unpublish" | "archive" | "unarchive") {
    setModalError(null);
    setFeedback(null);
    setModal(kind);
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
        {canPublish && !archived && (
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
        {canPublish && published && (
          <button
            type="button"
            onClick={() => openModal("unpublish")}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Unpublish
          </button>
        )}
        {canPublish && !archived && !publiclyListed && (
          <button
            type="button"
            disabled={busy === "list"}
            onClick={() => runListing(true)}
            className="border border-accent bg-white px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
          >
            List publicly
          </button>
        )}
        {canPublish && !archived && publiclyListed && (
          <button
            type="button"
            disabled={busy === "unlist"}
            onClick={() => runListing(false)}
            className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            Unlist
          </button>
        )}
        {canManage &&
          (!archived ? (
            <button
              type="button"
              onClick={() => openModal("archive")}
              className="border border-danger/40 bg-white px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-surface"
            >
              Archive
            </button>
          ) : (
            <button
              type="button"
              onClick={() => openModal("unarchive")}
              className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
            >
              Un-archive
            </button>
          ))}
        <a
          href={`/staff/programmes/${programmeId}/arrange`}
          className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
        >
          Arrange courses
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
        title="Unpublish this programme's content"
        description="Learners on running cohorts keep the version they were pinned to."
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
        title="Archive this programme"
        description="It leaves the public catalogue immediately. It cannot be archived while a cohort is running."
        confirmLabel="Archive programme"
        minReasonLength={10}
        reasonLabel="Reason for archiving"
        pending={busy === "archive"}
        error={modal === "archive" ? modalError : null}
        onConfirm={(reason) => runReasoned("archive", reason)}
        onCancel={() => setModal(null)}
      />
      <ConfirmModal
        open={modal === "unarchive"}
        title="Un-archive this programme"
        description="It returns to draft and stays unlisted — publishing and listing it again are separate steps."
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
