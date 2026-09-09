/**
 * Course operations.
 *
 * The reference example for every other resource in this codebase. Note what
 * it does NOT contain: no authorization logic, no audit calls, no scope
 * checks. Those come from the factory. A service that re-implements any of
 * them is doing it wrong.
 */

import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import { recordAudit } from "@/server/services/audit-service";
import { createResourceService, type Delegate } from "./resource-service";

type CourseRecord = { id: string };

/** A Course is reached by a Course-scoped grant, or any global grant. */
export function courseScope(id: string): ResourceScope {
  return { courseIds: [id] };
}

export const courseService = createResourceService<CourseRecord>({
  name: "Course",
  delegate: prisma.course as unknown as Delegate<CourseRecord>,
  permissions: {
    view: "courses.view",
    create: "courses.create",
    edit: "courses.edit",
  },
  toScope: courseScope,
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
});
