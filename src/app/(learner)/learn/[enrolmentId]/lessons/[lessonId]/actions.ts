"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  markLessonComplete,
  undoLessonComplete,
  recordWatchProgress,
  LessonNotOpenableError,
  ManualCompletionNotPermittedError,
  NotAVideoLessonError,
  InvalidWatchProgressError,
} from "@/server/services/lesson-progress-service";

/**
 * The lesson reading pane's two Server Actions (LRN-05, 09-11 Task 2).
 *
 * Both derive identity from the session — `getCurrentActor()` — and NEVER
 * read an actor or user id off the submitted form (T-09-02): this file never
 * reads a userId- or actorId-named field from the form data it receives,
 * matching the "derive identity from the session, not the request body"
 * example
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, the
 * `completeItem`-not-`completeItemUnsafe` pattern) rather than trusting a
 * client-supplied identity field. `enrolmentId`/`lessonId` are references
 * the client legitimately names; the actor performing the action is always
 * re-derived server-side.
 *
 * Revalidation: `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`
 * ("Choosing a cache update") names `revalidatePath` for exactly this shape
 * — one affected route, tagging overkill — so a successful mark/undo
 * refreshes this same lesson page's data inside the action's own response
 * (the docs' "single response carries data and UI" model), rather than
 * leaving the control showing stale state until an unrelated navigation.
 * Called before any `redirect`, per the same doc's note that code after
 * `redirect` (a thrown control-flow exception) never runs.
 */

function lessonPath(enrolmentId: string, lessonId: string): string {
  return `/learn/${enrolmentId}/lessons/${lessonId}`;
}

/**
 * Maps every `LessonNotOpenableError` reason to its destination, shared by
 * both actions below:
 *  - `"not-found"` / `"locked"` -> the lesson-list page. The reading pane
 *    should never have been reachable in either state, so the list is the
 *    safest re-orientation point (mirrors the page's own `notFound()`
 *    treatment of both reasons as one outcome).
 *  - `"access-window-closed"` -> back to this same lesson page, which
 *    re-derives and renders the ended-access panel itself from a fresh
 *    read — this action never renders anything.
 */
function redirectForNotOpenable(error: LessonNotOpenableError): never {
  if (error.reason === "access-window-closed") {
    redirect(lessonPath(error.enrolmentId, error.lessonId));
  }
  redirect(`/learn/${error.enrolmentId}`);
}

/**
 * markLessonCompleteAction — marks the lesson complete for the session
 * actor (LRN-05).
 *
 * Refusals:
 *  - `LessonNotOpenableError` -> `redirectForNotOpenable` above.
 *  - `ManualCompletionNotPermittedError` -> back to this same lesson page —
 *    the control should not have rendered when `allowManualComplete` is
 *    `false`; the page re-derives the truth on its own next read rather
 *    than this action asserting anything about why it was refused.
 *  - Any other error re-throws to the route's error boundary.
 */
export async function markLessonCompleteAction(formData: FormData): Promise<void> {
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  try {
    await markLessonComplete(actor, { enrolmentId, lessonId });
  } catch (error) {
    if (error instanceof LessonNotOpenableError) redirectForNotOpenable(error);
    if (error instanceof ManualCompletionNotPermittedError) {
      redirect(lessonPath(enrolmentId, lessonId));
    }
    throw error;
  }

  revalidatePath(lessonPath(enrolmentId, lessonId));
}

/**
 * undoLessonCompleteAction — the free, no-reason self-undo (D-13/D-15).
 *
 * `undoLessonComplete` itself permits an already-`locked` lesson through
 * (undoing an earlier lesson is exactly what causes a later one to lock),
 * so only `"not-found"` and `"access-window-closed"` are ever thrown here in
 * practice — both handled by the same `redirectForNotOpenable` mapping used
 * above, kept shared so the two actions cannot drift on destination choice.
 */
export async function undoLessonCompleteAction(formData: FormData): Promise<void> {
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  try {
    await undoLessonComplete(actor, { enrolmentId, lessonId });
  } catch (error) {
    if (error instanceof LessonNotOpenableError) redirectForNotOpenable(error);
    throw error;
  }

  revalidatePath(lessonPath(enrolmentId, lessonId));
}

/**
 * recordWatchProgressAction — the throttled watch-position write dispatched
 * imperatively by `VideoWatchTracker` (09-12 Task 1, D-09, DD-28/DD-29).
 *
 * Unlike the two actions above, this one takes a plain object rather than
 * `FormData` — it is called from a `useEffect` timer/listener, never
 * submitted from a `<form>`.
 *
 * A missing session actor returns `{ completed: false }` rather than
 * redirecting (DD-29): a background write firing after the session has
 * expired, or while the tab is backgrounded, must never navigate the
 * learner away mid-video. The same silent-refusal shape covers every typed
 * domain refusal (`LessonNotOpenableError`, `NotAVideoLessonError`,
 * `InvalidWatchProgressError`) — the client has no useful recovery for any
 * of them, and DD-29 requires the failure to stay invisible to playback.
 * Any OTHER error re-throws to the route's error boundary, matching the
 * other two actions' convention.
 *
 * Revalidation: unlike `markLessonCompleteAction`/`undoLessonCompleteAction`
 * (which revalidate on every successful call because a learner-initiated
 * submit is inherently a single, deliberate event), this action is dispatched
 * on a 15-second timer during playback (DD-28) — revalidating the whole
 * route on every throttled tick would re-render the page roughly four times
 * a minute while a video plays. `revalidatePath`
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`,
 * "Choosing a cache update" — the same API and the same one-affected-route
 * reasoning `markLessonCompleteAction` already uses above) is therefore
 * called ONLY on the tick where `recordWatchProgress`'s returned `completed`
 * transitions to `true`, never on every tick.
 *
 * Deliberately simple, fast and idempotent: the client dispatches it on a
 * timer, so it must never itself become the slow part of the throttle loop.
 */
export async function recordWatchProgressAction(input: {
  enrolmentId: string;
  lessonId: string;
  secondsWatched: number;
  durationSeconds: number | null;
}): Promise<{ completed: boolean }> {
  const actor = await getCurrentActor();
  if (!actor) return { completed: false };

  try {
    const result = await recordWatchProgress(actor, {
      enrolmentId: input.enrolmentId,
      lessonId: input.lessonId,
      secondsWatched: input.secondsWatched,
      durationSeconds: input.durationSeconds,
    });

    if (result.completed) {
      revalidatePath(lessonPath(input.enrolmentId, input.lessonId));
    }

    return { completed: result.completed };
  } catch (error) {
    if (
      error instanceof LessonNotOpenableError ||
      error instanceof NotAVideoLessonError ||
      error instanceof InvalidWatchProgressError
    ) {
      return { completed: false };
    }
    throw error;
  }
}
