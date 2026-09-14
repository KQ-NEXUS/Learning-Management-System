/**
 * The write side of learner progress tracking (LRN-04, LRN-05): marking and
 * self-undoing a lesson, the video watch-position write that auto-completes
 * at 90%, and the mandatory-reason staff override.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-15 — EXACTLY ONE `withPermission`-WRAPPED EXPORT IN THIS FILE.
 * ─────────────────────────────────────────────────────────────────────────────
 * `markLessonComplete`, `undoLessonComplete` and `recordWatchProgress` are
 * ownership-scoped — like `learner-access.ts` and `checkout-service.ts`'s
 * `getOwnOrder`, authorization here is an ownership comparison
 * (`loadLearnerPath` re-derives the enrolment from `actor.userId`), not a
 * permission check, and they MUST NOT be wrapped in `withPermission`.
 * `overrideLessonProgress` (D-14) IS staff RBAC and MUST be wrapped, on
 * `"enrolments.manage"` with `enrolmentCohortScope` — the closed 36-identifier
 * catalogue has no progress-specific permission and this phase does not add
 * one. Because this single file imports the permission choke point
 * (`withPermission`) at module scope, ES module imports are whole-file
 * (`enrolment-transitions.ts`'s header documents this exact hazard) — the
 * ownership exports must never be imported by anything on a worker or webhook
 * import closure. They are only ever called from Server Actions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-16 — MANUAL AND AUTO-VIDEO COMPLETION GATE ON INDEPENDENT FLAGS.
 * ─────────────────────────────────────────────────────────────────────────────
 * Manual completion (`markLessonComplete`) is gated on
 * `lesson.allowManualComplete === true` ALONE, regardless of `lesson.type`.
 * Auto-video completion (`recordWatchProgress`) is gated on
 * `lesson.type === "VIDEO"` ALONE, regardless of `allowManualComplete`. Both
 * may be true for the same lesson; the `LessonProgress` `@@unique` constraint
 * makes either source idempotent — whichever write lands first wins the row,
 * and the other becomes a no-op.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DD-4 — A LOCKED LESSON IS REFUSED AT WRITE TIME, NOT ONLY AT RENDER TIME.
 * ─────────────────────────────────────────────────────────────────────────────
 * `assertLessonOpenable` runs before every mark/watch write (LRN-04's "not
 * advanced by unauthorized requests") because a Server Action is a public
 * entry point — a UI lock is not a gate. `undoLessonComplete` is the one
 * exception: un-completing an already-locked lesson is exactly D-16's
 * cascade scenario. Undo performs no cascade write of its own — downstream
 * lessons re-lock because sequencing is recomputed lazily on the next read
 * (DD-4, `learner-access.ts`'s own header states the identical rule).
 *
 * D-17 (this plan): the video completion threshold is 90 percent of
 * `durationSeconds`, evaluated SERVER-SIDE from the stored
 * `LessonWatchProgress` row, never from a client-supplied "complete" flag.
 * `VIDEO_COMPLETION_PCT` is exported so the client island can import the same
 * number for its caption logic without redefining it.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { Actor } from "@/server/permissions/with-permission";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import { enrolmentCohortScope } from "@/server/services/cohort-scope";
import {
  recalculateCompletion,
  type CompletionServiceTxClient,
  type CompletionRecalculationResult,
} from "@/server/services/completion-service";
import {
  loadLearnerPath as liveLoadLearnerPath,
  assertLessonOpenable,
  type LearnerPath,
  type DecoratedLesson,
} from "@/server/services/learner-access";
import { evaluateLessonSequencing, type SequencingLesson } from "@/server/services/lesson-sequencing";

type WithPermission = ReturnType<typeof createWithPermission>;
type Audit = (entry: ResourceAuditEntry) => Promise<void>;

/** The video auto-completion threshold (D-17) — exported so the client island's caption logic reads the same number. */
export const VIDEO_COMPLETION_PCT = 90;

// ---------------------------------------------------------------------------
// Typed refusals — each one a Server Action turns into a specific message.
// ---------------------------------------------------------------------------

/**
 * The four reasons a progress write may be refused: the enrolment isn't the
 * caller's own or doesn't exist (`not-found`, also used for a cross-course
 * lesson id), the lesson is prerequisite-locked (`locked`), or D-03's access
 * window is closed (`access-window-closed`).
 */
export class LessonNotOpenableError extends Error {
  readonly enrolmentId: string;
  readonly lessonId: string;
  readonly reason: "not-found" | "locked" | "access-window-closed";

  constructor(
    enrolmentId: string,
    lessonId: string,
    reason: "not-found" | "locked" | "access-window-closed",
  ) {
    super(LessonNotOpenableError.messageFor(reason));
    this.name = "LessonNotOpenableError";
    this.enrolmentId = enrolmentId;
    this.lessonId = lessonId;
    this.reason = reason;
  }

  private static messageFor(reason: "not-found" | "locked" | "access-window-closed"): string {
    switch (reason) {
      case "not-found":
        return "This lesson is not part of your enrolled path.";
      case "locked":
        return "Complete the required lesson before this one to unlock it.";
      case "access-window-closed":
        return "Your access window for this course has closed.";
    }
  }
}

/** `markLessonComplete` refused because `lesson.allowManualComplete !== true` (DD-16). */
export class ManualCompletionNotPermittedError extends Error {
  readonly lessonId: string;

  constructor(lessonId: string) {
    super("This lesson cannot be marked complete manually.");
    this.name = "ManualCompletionNotPermittedError";
    this.lessonId = lessonId;
  }
}

/** `recordWatchProgress` refused because `lesson.type !== "VIDEO"` (DD-16). */
export class NotAVideoLessonError extends Error {
  readonly lessonId: string;

  constructor(lessonId: string) {
    super("Watch progress can only be recorded for video lessons.");
    this.name = "NotAVideoLessonError";
    this.lessonId = lessonId;
  }
}

/**
 * A non-finite or negative `secondsWatched`/`durationSeconds` — rejected
 * outright rather than silently coerced to zero, so a caller bug never
 * silently resets a learner's high-water mark.
 */
export class InvalidWatchProgressError extends Error {
  readonly field: string;
  readonly value: number;

  constructor(field: string, value: number) {
    super(`${field} must be a finite, non-negative number (received ${value}).`);
    this.name = "InvalidWatchProgressError";
    this.field = field;
    this.value = value;
  }
}

/** `overrideLessonProgress` refused because `reason` is missing, empty or whitespace-only (D-14). */
export class OverrideReasonRequiredError extends Error {
  readonly enrolmentId: string;
  readonly lessonId: string;

  constructor(enrolmentId: string, lessonId: string) {
    super("A reason is required to override a learner's lesson progress.");
    this.name = "OverrideReasonRequiredError";
    this.enrolmentId = enrolmentId;
    this.lessonId = lessonId;
  }
}

// ---------------------------------------------------------------------------
// Injected surface — a Prisma transaction client satisfies it and so does a
// unit-test fake. Narrower than `CompletionServiceTxClient` on purpose: this
// file casts its own `tx` to that wider type only at the `recalculateCompletion`
// call site, mirroring `attendance-service.ts`'s identical cast.
// ---------------------------------------------------------------------------

export type LessonProgressRow = {
  enrolmentId: string;
  lessonId: string;
  completedAt: Date;
  source: string;
};

export type LessonWatchProgressRow = {
  enrolmentId: string;
  lessonId: string;
  secondsWatched: number;
  durationSeconds: number | null;
  percentWatched: number;
  updatedAt: Date;
};

export type LessonProgressTxClient = DomainEventTxClient & {
  lessonProgress: {
    findUnique(args: {
      where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
    }): Promise<LessonProgressRow | null>;
    upsert(args: {
      where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<LessonProgressRow>;
    delete(args: {
      where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
    }): Promise<unknown>;
  };
  lessonWatchProgress: {
    findUnique(args: {
      where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
    }): Promise<LessonWatchProgressRow | null>;
    upsert(args: {
      where: { enrolmentId_lessonId: { enrolmentId: string; lessonId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<LessonWatchProgressRow>;
  };
};

/**
 * The narrow structural store slice read OUTSIDE the write transaction —
 * used only by `overrideLessonProgress` to resolve the enrolment's owning
 * `userId` so a staff caller (whose own `actor.userId` is never the
 * learner's) can still call the ownership-scoped `loadLearnerPath` on the
 * learner's behalf.
 */
export type LessonProgressStore = {
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<{ userId: string } | null>;
  };
};

export type LessonProgressServiceDeps = {
  store: LessonProgressStore;
  loadLearnerPath: (actor: Actor, enrolmentId: string) => Promise<LearnerPath | null>;
  audit: Audit;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: LessonProgressTxClient) => Promise<R>) => Promise<R>;
  recalculateCompletion: (
    tx: CompletionServiceTxClient,
    args: { enrolmentId: string; now: Date },
  ) => Promise<CompletionRecalculationResult>;
  /** Resolves an enrolment id to its owning cohort's `ResourceScope` — the staff-override gate only. */
  enrolmentScope: (enrolmentId: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A non-empty, trimmed reason, or `null` when blank — same semantics as `attendance-service.ts`'s helper. */
function trimReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Finds a lesson anywhere in the path WITHOUT applying lock/access-window
 * gating — used by `overrideLessonProgress`, which is gated on path
 * membership only (D-14 explicitly does not gate on the sequencing lock or
 * the access window).
 */
function findLessonInPath(path: LearnerPath, lessonId: string): DecoratedLesson | null {
  for (const course of path.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        if (lesson.id === lessonId) return lesson;
      }
    }
  }
  return null;
}

/**
 * Flattens a `LearnerPath`'s decorated courses back into the flat
 * `SequencingLesson[]` shape `evaluateLessonSequencing` consumes — the same
 * course-position-stride convention `learner-access.ts`'s
 * `COURSE_POSITION_STRIDE` documents, duplicated here (rather than imported)
 * because that constant is private to its module.
 */
const COURSE_POSITION_STRIDE = 1_000_000;

function flattenSequencingLessons(path: LearnerPath): SequencingLesson[] {
  const flat: SequencingLesson[] = [];
  path.courses.forEach((course, courseIndex) => {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        flat.push({
          id: lesson.id,
          title: lesson.title,
          required: lesson.required,
          position: courseIndex * COURSE_POSITION_STRIDE + lesson.position,
          moduleId: mod.id,
          withdrawnAt: lesson.withdrawnAt,
        });
      }
    }
  });
  return flat;
}

/**
 * How many lessons would become locked if `lessonId`'s completion were
 * removed — computed by running `evaluateLessonSequencing` twice (with and
 * without `lessonId` in the completed set) and diffing, with NO write. This
 * is a pure read over an already-loaded `LearnerPath`, backing the UI's D-16
 * disclosure copy ("undoing this will re-lock N lesson(s)").
 */
export function countLessonsRelockedBy(path: LearnerPath, lessonId: string): number {
  const flat = flattenSequencingLessons(path);

  const withoutLesson = new Set(path.progress);
  withoutLesson.delete(lessonId);

  const before = evaluateLessonSequencing(flat, path.progress);
  const after = evaluateLessonSequencing(flat, withoutLesson);

  const lockedBefore = new Set(before.filter((r) => r.locked).map((r) => r.lessonId));
  let relocked = 0;
  for (const result of after) {
    if (result.locked && !lockedBefore.has(result.lessonId)) relocked += 1;
  }
  return relocked;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createLessonProgressService(deps: LessonProgressServiceDeps) {
  const { withPermission } = deps;
  const now = deps.now ?? (() => new Date());

  // -------------------------------------------------------------------------
  // markLessonComplete — learner self-mark (LRN-05, D-13, D-16)
  // -------------------------------------------------------------------------

  async function markLessonComplete(
    actor: Actor,
    args: { enrolmentId: string; lessonId: string },
  ): Promise<{ enrolmentId: string; lessonId: string; completed: true }> {
    const path = await deps.loadLearnerPath(actor, args.enrolmentId);
    if (!path) throw new LessonNotOpenableError(args.enrolmentId, args.lessonId, "not-found");

    const openResult = assertLessonOpenable(path, args.lessonId);
    if (!openResult.ok) {
      throw new LessonNotOpenableError(args.enrolmentId, args.lessonId, openResult.reason);
    }
    if (openResult.lesson.allowManualComplete !== true) {
      throw new ManualCompletionNotPermittedError(args.lessonId);
    }

    const nowValue = now();
    let created = false;

    await deps.runInTransaction(async (tx) => {
      const existing = await tx.lessonProgress.findUnique({
        where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
      });

      if (!existing) {
        created = true;
        // An already-existing row is a successful no-op: it must NOT move
        // completedAt and must NOT overwrite an AUTO_VIDEO/STAFF_OVERRIDE
        // source, so this write path is only reached when no row exists.
        await tx.lessonProgress.upsert({
          where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
          create: {
            enrolmentId: args.enrolmentId,
            lessonId: args.lessonId,
            source: "MANUAL",
            completedAt: nowValue,
          },
          update: {},
        });
      }

      await deps.recalculateCompletion(tx as unknown as CompletionServiceTxClient, {
        enrolmentId: args.enrolmentId,
        now: nowValue,
      });

      if (created) {
        await deps.writeEvent(tx, {
          type: "lesson.completed",
          payload: { enrolmentId: args.enrolmentId, lessonId: args.lessonId, source: "MANUAL" },
          occurredAt: nowValue,
        });
      }
    });

    await deps.audit({
      action: "lessonprogress.marked",
      targetType: "Enrolment",
      targetId: args.enrolmentId,
      actorId: actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { lessonId: args.lessonId, completed: !created },
      after: { lessonId: args.lessonId, completed: true },
    });

    return { enrolmentId: args.enrolmentId, lessonId: args.lessonId, completed: true };
  }

  // -------------------------------------------------------------------------
  // undoLessonComplete — free self-undo (D-13, D-15, D-16/DD-4)
  // -------------------------------------------------------------------------

  async function undoLessonComplete(
    actor: Actor,
    args: { enrolmentId: string; lessonId: string },
  ): Promise<{ enrolmentId: string; lessonId: string; completed: false }> {
    const path = await deps.loadLearnerPath(actor, args.enrolmentId);
    if (!path) throw new LessonNotOpenableError(args.enrolmentId, args.lessonId, "not-found");

    // Same gate as markLessonComplete EXCEPT `locked` is allowed through —
    // un-completing an earlier lesson is exactly what causes a later one to
    // be locked in the first place (D-16).
    const openResult = assertLessonOpenable(path, args.lessonId);
    if (!openResult.ok && openResult.reason !== "locked") {
      throw new LessonNotOpenableError(args.enrolmentId, args.lessonId, openResult.reason);
    }

    const nowValue = now();
    let existedBefore = false;

    await deps.runInTransaction(async (tx) => {
      const existing = await tx.lessonProgress.findUnique({
        where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
      });
      existedBefore = !!existing;

      // No cascade write over other lessons — downstream re-lock happens
      // lazily on the next read (DD-4). Only this one row is ever touched.
      if (existing) {
        await tx.lessonProgress.delete({
          where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
        });
      }

      await deps.recalculateCompletion(tx as unknown as CompletionServiceTxClient, {
        enrolmentId: args.enrolmentId,
        now: nowValue,
      });
    });

    await deps.audit({
      action: "lessonprogress.unmarked",
      targetType: "Enrolment",
      targetId: args.enrolmentId,
      actorId: actor.userId,
      outcome: "SUCCESS",
      reason: null,
      before: { lessonId: args.lessonId, completed: existedBefore },
      after: { lessonId: args.lessonId, completed: false },
    });

    return { enrolmentId: args.enrolmentId, lessonId: args.lessonId, completed: false };
  }

  // -------------------------------------------------------------------------
  // recordWatchProgress — video watch position + 90% auto-completion (D-08, D-09)
  // -------------------------------------------------------------------------

  /** Clamps to a finite non-negative integer, or throws (T-09-05 — never silently zeroed). */
  function toNonNegativeInt(value: number, field: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new InvalidWatchProgressError(field, value);
    }
    return Math.floor(value);
  }

  async function recordWatchProgress(
    actor: Actor,
    args: {
      enrolmentId: string;
      lessonId: string;
      secondsWatched: number;
      durationSeconds: number | null;
    },
  ): Promise<{ enrolmentId: string; lessonId: string; percentWatched: number; completed: boolean }> {
    const path = await deps.loadLearnerPath(actor, args.enrolmentId);
    if (!path) throw new LessonNotOpenableError(args.enrolmentId, args.lessonId, "not-found");

    const openResult = assertLessonOpenable(path, args.lessonId);
    if (!openResult.ok) {
      throw new LessonNotOpenableError(args.enrolmentId, args.lessonId, openResult.reason);
    }
    if (openResult.lesson.type !== "VIDEO") {
      throw new NotAVideoLessonError(args.lessonId);
    }

    // Server-side clamping — secondsWatched/durationSeconds are never
    // trusted verbatim, and percentWatched/complete are never read from the
    // request at all (the input type below carries neither field).
    let secondsWatched = toNonNegativeInt(args.secondsWatched, "secondsWatched");
    const durationSeconds =
      args.durationSeconds == null ? null : toNonNegativeInt(args.durationSeconds, "durationSeconds");
    if (durationSeconds !== null && durationSeconds > 0 && secondsWatched > durationSeconds) {
      secondsWatched = durationSeconds;
    }

    const percentWatched =
      durationSeconds !== null && durationSeconds > 0
        ? Math.floor((secondsWatched / durationSeconds) * 100)
        : 0;

    const nowValue = now();
    let completedNow = false;
    let resultingHighWaterPercent = percentWatched;

    await deps.runInTransaction(async (tx) => {
      const existingWatch = await tx.lessonWatchProgress.findUnique({
        where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
      });

      const priorSecondsWatched = existingWatch?.secondsWatched ?? 0;
      const priorPercentWatched = existingWatch?.percentWatched ?? 0;

      // High-water marks only ever move forward — a backwards scrub updates
      // durationSeconds/updatedAt but leaves the stored marks intact.
      const newSecondsWatched = Math.max(priorSecondsWatched, secondsWatched);
      const newPercentWatched = Math.max(priorPercentWatched, percentWatched);
      const advanced = newPercentWatched > priorPercentWatched;
      resultingHighWaterPercent = newPercentWatched;

      await tx.lessonWatchProgress.upsert({
        where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
        create: {
          enrolmentId: args.enrolmentId,
          lessonId: args.lessonId,
          secondsWatched: newSecondsWatched,
          durationSeconds,
          percentWatched: newPercentWatched,
          updatedAt: nowValue,
        },
        update: {
          secondsWatched: newSecondsWatched,
          durationSeconds,
          percentWatched: newPercentWatched,
          updatedAt: nowValue,
        },
      });

      // Re-completion after a D-15 undo requires the percent to genuinely
      // ADVANCE beyond the stored high-water mark (T-09-28) — a throttled
      // tick landing at the same percent as before an undo must not silently
      // re-create the completion.
      if (advanced && newPercentWatched >= VIDEO_COMPLETION_PCT) {
        const existingProgress = await tx.lessonProgress.findUnique({
          where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
        });

        if (!existingProgress) {
          completedNow = true;
          await tx.lessonProgress.upsert({
            where: { enrolmentId_lessonId: { enrolmentId: args.enrolmentId, lessonId: args.lessonId } },
            create: {
              enrolmentId: args.enrolmentId,
              lessonId: args.lessonId,
              source: "AUTO_VIDEO",
              completedAt: nowValue,
            },
            update: {},
          });

          await deps.recalculateCompletion(tx as unknown as CompletionServiceTxClient, {
            enrolmentId: args.enrolmentId,
            now: nowValue,
          });

          await deps.writeEvent(tx, {
            type: "lesson.completed",
            payload: { enrolmentId: args.enrolmentId, lessonId: args.lessonId, source: "AUTO_VIDEO" },
            occurredAt: nowValue,
          });
        }
      }
    });

    if (completedNow) {
      await deps.audit({
        action: "lessonprogress.marked",
        targetType: "Enrolment",
        targetId: args.enrolmentId,
        actorId: actor.userId,
        outcome: "SUCCESS",
        reason: null,
        before: { lessonId: args.lessonId, completed: false },
        after: { lessonId: args.lessonId, completed: true, source: "AUTO_VIDEO" },
      });
    }

    return {
      enrolmentId: args.enrolmentId,
      lessonId: args.lessonId,
      percentWatched: resultingHighWaterPercent,
      completed: completedNow,
    };
  }

  // -------------------------------------------------------------------------
  // overrideLessonProgress — mandatory-reason staff correction (D-14)
  // -------------------------------------------------------------------------
  //
  // The ONLY `withPermission`-wrapped export in this file (DD-15). Mirrors
  // Phase 5's attendance-correction pattern: mandatory reason, actor and
  // timestamp recorded, visible in audit history. `"enrolments.manage"` is
  // used because the closed 36-identifier catalogue has no progress-specific
  // permission and this phase does not extend it.

  const overrideLessonProgress = withPermission<{
    enrolmentId: string;
    lessonId: string;
    complete: boolean;
    reason: string;
  }>("enrolments.manage", (input) => deps.enrolmentScope(input.enrolmentId))(
    async (input, ctx) => {
      const reason = trimReason(input.reason);
      if (!reason) throw new OverrideReasonRequiredError(input.enrolmentId, input.lessonId);

      // A staff actor is never the enrolment's own owner, so the ownership-
      // scoped loadLearnerPath is called on the learner's behalf: resolve the
      // true owner's userId first, then load THEIR path.
      const enrolmentRow = await deps.store.enrolment.findUnique({ where: { id: input.enrolmentId } });
      if (!enrolmentRow) {
        throw new LessonNotOpenableError(input.enrolmentId, input.lessonId, "not-found");
      }

      const path = await deps.loadLearnerPath({ userId: enrolmentRow.userId }, input.enrolmentId);
      if (!path) throw new LessonNotOpenableError(input.enrolmentId, input.lessonId, "not-found");

      // Gated ONLY on path membership — NOT allowManualComplete, NOT the
      // sequencing lock, NOT the access window (D-14 exists precisely to
      // correct a state the learner's own rules cannot reach).
      const lesson = findLessonInPath(path, input.lessonId);
      if (!lesson) throw new LessonNotOpenableError(input.enrolmentId, input.lessonId, "not-found");

      const nowValue = now();
      let existedBefore = false;

      await deps.runInTransaction(async (tx) => {
        const existing = await tx.lessonProgress.findUnique({
          where: { enrolmentId_lessonId: { enrolmentId: input.enrolmentId, lessonId: input.lessonId } },
        });
        existedBefore = !!existing;

        if (input.complete) {
          await tx.lessonProgress.upsert({
            where: { enrolmentId_lessonId: { enrolmentId: input.enrolmentId, lessonId: input.lessonId } },
            create: {
              enrolmentId: input.enrolmentId,
              lessonId: input.lessonId,
              source: "STAFF_OVERRIDE",
              completedAt: nowValue,
            },
            update: { source: "STAFF_OVERRIDE", completedAt: nowValue },
          });
        } else if (existing) {
          await tx.lessonProgress.delete({
            where: { enrolmentId_lessonId: { enrolmentId: input.enrolmentId, lessonId: input.lessonId } },
          });
        }

        await deps.recalculateCompletion(tx as unknown as CompletionServiceTxClient, {
          enrolmentId: input.enrolmentId,
          now: nowValue,
        });
      });

      await deps.audit({
        action: "lessonprogress.overridden",
        targetType: "Enrolment",
        targetId: input.enrolmentId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: { lessonId: input.lessonId, completed: existedBefore },
        after: {
          lessonId: input.lessonId,
          completed: input.complete,
          source: input.complete ? "STAFF_OVERRIDE" : null,
        },
      });

      return { enrolmentId: input.enrolmentId, lessonId: input.lessonId, completed: input.complete };
    },
  );

  return { markLessonComplete, undoLessonComplete, recordWatchProgress, overrideLessonProgress };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

const liveAudit: Audit = (entry) =>
  recordAudit({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    outcome: entry.outcome,
  });

/**
 * Builds the lesson-progress service against a given Prisma client and
 * `withPermission`. Production passes the singleton and the live authorizer;
 * tests pass fakes for `loadLearnerPath`/`recalculateCompletion`/`audit` so
 * the write logic is exercised without a database, matching
 * `attendance-service.ts`'s own binding shape.
 */
export function createPrismaBackedLessonProgressService(
  client: AnyPrisma,
  withPermission: WithPermission,
  audit: Audit = liveAudit,
  recalculateCompletionDep: LessonProgressServiceDeps["recalculateCompletion"] = recalculateCompletion,
  loadLearnerPathDep: LessonProgressServiceDeps["loadLearnerPath"] = liveLoadLearnerPath,
) {
  return createLessonProgressService({
    store: {
      enrolment: {
        findUnique: (args) =>
          client.enrolment.findUnique({ where: args.where, select: { userId: true } }),
      },
    },
    loadLearnerPath: loadLearnerPathDep,
    audit,
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) => client.$transaction((tx: unknown) => fn(tx as LessonProgressTxClient)),
    recalculateCompletion: recalculateCompletionDep,
    enrolmentScope: enrolmentCohortScope,
    withPermission,
  });
}

const built = createPrismaBackedLessonProgressService(prisma, liveWithPermission);

export const markLessonComplete = built.markLessonComplete;
export const undoLessonComplete = built.undoLessonComplete;
export const recordWatchProgress = built.recordWatchProgress;
export const overrideLessonProgress = built.overrideLessonProgress;
