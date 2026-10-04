"use server";

/**
 * Server Action for the learner number settings screen.
 *
 * It is a public POST endpoint like every Server Action, so it validates its
 * input and leaves authorization to the service, which requires `users.manage`
 * at GLOBAL scope. The pattern's own rules live in `@/lib/learner-number` and
 * are re-applied in the service: the screen's live preview is a convenience,
 * never the check.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, refusalMessage } from "@/server/permissions";
import {
  InvalidLearnerNumberPatternError,
  saveLearnerNumberPattern,
  type LearnerNumberSettings,
} from "@/server/services/learner-number-service";

const schema = z.object({ pattern: z.string().max(200) }).strict();

export type SaveLearnerNumberPatternResult =
  | { ok: true; settings: LearnerNumberSettings }
  | { ok: false; message: string };

export async function saveLearnerNumberPatternAction(input: unknown): Promise<SaveLearnerNumberPatternResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a pattern, for example KQL-######." };

  try {
    const settings = await saveLearnerNumberPattern({ pattern: parsed.data.pattern });
    revalidatePath("/staff/learner-numbers");
    return { ok: true, settings };
  } catch (error) {
    if (error instanceof InvalidLearnerNumberPatternError) return { ok: false, message: error.message };
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: refusalMessage(error, "Your role does not permit changing learner number settings.") };
    }
    throw error;
  }
}
