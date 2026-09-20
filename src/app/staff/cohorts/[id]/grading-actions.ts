"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { MAX_BATCH_RELEASE, releaseGradesBatch, listGradingQueue, listCohortGradingSummary } from "@/server/services/grading-service";

const schema = z.object({ cohortId: z.string().min(1), gradeIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_RELEASE) }).strict();
export async function releaseGradesBatchAction(input: unknown) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: `Select between 1 and ${MAX_BATCH_RELEASE} grades to release.` };
  try {
    // Resolve the submitted cohort independently; all supplied IDs must belong to its visible queues.
    const summaries = await listCohortGradingSummary({ cohortId: parsed.data.cohortId });
    const queues = await Promise.all(summaries.map(a => listGradingQueue({ cohortId: parsed.data.cohortId, assessmentId: a.assessmentId })));
    const allowed = new Set(queues.flat().map(r => r.gradeId).filter(Boolean));
    if (parsed.data.gradeIds.some(id => !allowed.has(id))) return { ok: false as const, message: "The selected grades do not belong to this Cohort's grading queues." };
    const result = await releaseGradesBatch({ gradeIds: parsed.data.gradeIds });
    revalidatePath(`/staff/cohorts/${parsed.data.cohortId}`, "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false as const, message: "Your role does not permit releasing these grades." };
    return { ok: false as const, message: "These grades could not be released. Reload the queue and try again." };
  }
}
