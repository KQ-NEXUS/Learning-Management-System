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
  backfillLearnerNumbers,
  InvalidLearnerNumberPatternError,
  LearnerNumbersOffError,
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

export type BackfillLearnerNumbersResult =
  | { ok: true; numbered: number; first: string | null; last: string | null; settings: LearnerNumberSettings }
  | { ok: false; message: string };

/**
 * Gives a number to every learner who has none. Takes no input: who is numbered, and in what
 * order, is decided entirely by the service.
 */
export async function backfillLearnerNumbersAction(): Promise<BackfillLearnerNumbersResult> {
  try {
    const result = await backfillLearnerNumbers();
    revalidatePath("/staff/learner-numbers");
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof LearnerNumbersOffError) return { ok: false, message: error.message };
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: refusalMessage(error, "Your role does not permit changing learner number settings.") };
    }
    throw error;
  }
}
