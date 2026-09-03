/**
 * Lesson operations.
 *
 * A Lesson has no permission of its own either — every mutation gates on
 * the grandparent Course's courses.edit, resolved by querying
 * Lesson -> Module -> Course rather than trusted from the caller (T-04-11).
 * Withdrawal is not deletion (D-17/D-03): a withdrawn Lesson keeps its row
 * so a Cohort pinned to a publication that included it still resolves, and
 * so LessonProgress and completion records are never orphaned.
 *
 * `createLesson` computes position; `parseLessonInput`/`parseLessonUpdateInput`
 * (D-30 sanitisation, D-24 required toggle, D-31 QUIZ/ASSIGNMENT empty
 * picker) validate `createLesson`/`updateLesson`'s input before either
 * delegates — the raw factory `create`/`update` must never be the path any
 * UI calls.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import { nextAppendPosition, parkedWithdrawnPosition } from "@/lib/positions";
import { parseLessonInput, parseLessonUpdateInput } from "@/lib/lesson-input";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";

export type LessonRecord = {
  id: string;
  moduleId: string;
  title: string;
  type: string;
  position: number;
  body: string | null;
  embedUrl: string | null;
  linkUrl: string | null;
  required: boolean;
  allowManualComplete: boolean;
  assessmentId: string | null;
  withdrawnAt: Date | null;
};

/** The subset of the real Prisma Lesson delegate this file uses. */
export type LessonDelegate = Delegate<LessonRecord>;

type WithPermissionFn = ReturnType<typeof createWithPermission>;

export type CreateLessonServiceDeps = {
  delegate: LessonDelegate;
  /**
   * Resolves a Module id to its parent Course id. Production queries Prisma
   * directly (`Lesson -> Module -> Course`); tests inject an in-memory
   * lookup instead of a real client. Null when the Module does not exist.
   */
  resolveCourseIdForModule: (moduleId: string) => Promise<string | null>;
  withPermission: WithPermissionFn;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  runInTransaction?: <R>(fn: () => Promise<R>) => Promise<R>;
};

/**
 * Builds the whole Lesson surface against injected dependencies, in the
 * style of `module-service.ts`'s `createModuleService`, so tests can supply
 * an in-memory fake delegate rather than a real Prisma client.
 */
export function createLessonService(deps: CreateLessonServiceDeps) {
  const { delegate, resolveCourseIdForModule } = deps;
  const runInTransaction = deps.runInTransaction ?? (<R,>(fn: () => Promise<R>) => fn());

  /**
   * Resolves through Lesson -> Module -> Course rather than trusting a
   * caller-supplied Course id. Resolves to a denial (`{ courseIds: [] }`),
   * not a throw, when the Lesson or its parent Module is unknown.
   */
  async function lessonScope(id: string): Promise<ResourceScope> {
    const lesson = await delegate.findUnique({ where: { id } });
    if (!lesson) return { courseIds: [] };
    const courseId = await resolveCourseIdForModule(lesson.moduleId);
    return { courseIds: courseId ? [courseId] : [] };
  }

  const lessonService = createResourceService<LessonRecord>({
    name: "Lesson",
    delegate,
    permissions: { view: "courses.view", create: "courses.edit", edit: "courses.edit" },
    toScope: lessonScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
    runInTransaction: deps.runInTransaction,
    // Exact mirror of Module's archive/restore asymmetry — see
    // module-service.ts's inline comment for why the two qualifiers differ.
    archiveData: async (id) => {
      const row = await delegate.findUnique({ where: { id } });
      const siblings = row ? await delegate.findMany({ where: { moduleId: row.moduleId } }) : [];
      const minPosition = siblings.length
        ? Math.min(...siblings.map((s) => s.position))
        : null;
      return { withdrawnAt: new Date(), position: parkedWithdrawnPosition(minPosition) };
    },
    restoreData: async (id) => {
      const row = await delegate.findUnique({ where: { id } });
      const liveSiblings = row
        ? (await delegate.findMany({ where: { moduleId: row.moduleId } })).filter(
            (s) => s.withdrawnAt === null,
          )
        : [];
      const maxPosition = liveSiblings.length
        ? Math.max(...liveSiblings.map((s) => s.position))
        : null;
      return { withdrawnAt: null, position: nextAppendPosition(maxPosition) };
    },
  });

  // The factory's raw `create`/`update` must never be the path any UI
  // calls. `createLesson`/`updateLesson` are the only paths: both validate
  // through `parseLessonInput`/`parseLessonUpdateInput` — sanitising body
  // and validating embed/link URLs (T-04-12, T-04-13) — BEFORE delegating,
  // and `createLesson` is also the only path that computes position.
  const createLesson = deps.withPermission<{
    moduleId: string;
    title: string;
    type: string;
    body?: string;
    embedUrl?: string;
    linkUrl?: string;
    required?: boolean;
    allowManualComplete?: boolean;
    assessmentId?: string | null;
  }>("courses.edit", async (input) => {
    const courseId = await resolveCourseIdForModule(input.moduleId);
    return { courseIds: courseId ? [courseId] : [] };
  })(async (input, ctx) => {
    const parsed = parseLessonInput(input);

    const created = await runInTransaction(async () => {
      const liveSiblings = (
        await delegate.findMany({ where: { moduleId: parsed.moduleId } })
      ).filter((s) => s.withdrawnAt === null);
      const maxPosition = liveSiblings.length
        ? Math.max(...liveSiblings.map((s) => s.position))
        : null;
      const position = nextAppendPosition(maxPosition);

      return delegate.create({
        data: {
          moduleId: parsed.moduleId,
          title: parsed.title,
          type: parsed.type,
          body: parsed.body ?? null,
          embedUrl: parsed.embedUrl ?? null,
          linkUrl: parsed.linkUrl ?? null,
          required: parsed.required,
          allowManualComplete: parsed.allowManualComplete,
          assessmentId: parsed.assessmentId ?? null,
          position,
        },
      });
    });

    await deps.audit({
      action: "lesson.created",
      targetType: "Lesson",
      targetId: created.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason: null,
      after: created,
    });

    return created;
  });

  // Validates through parseLessonUpdateInput (moduleId/title/type all
  // optional — an update is not a re-parenting surface) before delegating
  // to the factory's `update`, which already gates on courses.edit via
  // `lessonScope`. No separate withPermission wrapper needed here.
  const updateLesson = (id: string, data: Record<string, unknown>, reason?: string) => {
    const parsed = parseLessonUpdateInput(data);
    return lessonService.update(id, parsed, reason);
  };

  const listActiveLessons = deps.withPermission<string>("courses.view", async (moduleId) => {
    const courseId = await resolveCourseIdForModule(moduleId);
    return { courseIds: courseId ? [courseId] : [] };
  })(async (moduleId) => {
    const rows = await delegate.findMany({ where: { moduleId } });
    return rows.filter((r) => r.withdrawnAt === null).sort((a, b) => a.position - b.position);
  });

  const listWithdrawnLessons = deps.withPermission<string>("courses.view", async (moduleId) => {
    const courseId = await resolveCourseIdForModule(moduleId);
    return { courseIds: courseId ? [courseId] : [] };
  })(async (moduleId) => {
    const rows = await delegate.findMany({ where: { moduleId } });
    return rows.filter((r) => r.withdrawnAt !== null).sort((a, b) => a.position - b.position);
  });

  return {
    lessonScope,
    lessonService,
    createLesson,
    updateLesson,
    listActiveLessons,
    listWithdrawnLessons,
  };
}

const built = createLessonService({
  delegate: prisma.lesson as unknown as LessonDelegate,
  resolveCourseIdForModule: async (moduleId) => {
    const row = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { courseId: true },
    });
    return row?.courseId ?? null;
  },
  withPermission,
  audit: (entry) =>
    recordAudit({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      outcome: entry.outcome,
    }),
  runInTransaction: (fn) => prisma.$transaction(fn),
});

export const lessonScope = built.lessonScope;
export const lessonService = built.lessonService;

/**
 * The LessonType of a lesson, by id, with no permission wrapper.
 *
 * The upload Route Handler calls this only AFTER it has authorized
 * `courses.edit` on the very same lesson via `lessonScope`, so it opens no new
 * access surface — it exists so the handler can validate an upload against the
 * lesson's own type (`validateUpload`) without a second authorized round trip.
 * Returns null when the lesson does not exist.
 */
export async function getLessonTypeById(lessonId: string): Promise<string | null> {
  const row = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { type: true },
  });
  return row?.type ?? null;
}
export const createLesson = built.createLesson;
export const updateLesson = built.updateLesson;
export const listActiveLessons = built.listActiveLessons;
export const listWithdrawnLessons = built.listWithdrawnLessons;

/**
 * The aggregate plans 04-06, 04-08, 04-09 and 04-12 all load: a Course with
 * its non-withdrawn Modules, each with its non-withdrawn Lessons, both
 * ordered by position ascending. `updatedAt` is included because plans
 * 04-05 and 04-08 use it as the D-23 optimistic-concurrency token.
 */
export type LoadedCourseTree = {
  id: string;
  updatedAt: Date;
  modules: Array<{
    id: string;
    title: string;
    summary: string | null;
    position: number;
    lessons: Array<{
      id: string;
      title: string;
      type: string;
      position: number;
      required: boolean;
      allowManualComplete: boolean;
      assessmentId: string | null;
      embedUrl: string | null;
      linkUrl: string | null;
      body: string | null;
    }>;
  }>;
};

export const loadCourseTree = withPermission<string>("courses.view", (courseId) => ({
  courseIds: [courseId],
}))(async (courseId): Promise<LoadedCourseTree | null> => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      updatedAt: true,
      modules: {
        where: { withdrawnAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          summary: true,
          position: true,
          lessons: {
            where: { withdrawnAt: null },
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              type: true,
              position: true,
              required: true,
              allowManualComplete: true,
              assessmentId: true,
              embedUrl: true,
              linkUrl: true,
              body: true,
            },
          },
        },
      },
    },
  });
  return course;
});
