"use server";

/**
 * Notification-drawer server actions (D-16, D-19).
 *
 * `markAllNotificationsReadAction` and `saveEmailPreferencesAction` both
 * resolve the actor from the session themselves — never trust a caller-
 * supplied user id — and return a generic, non-revealing message on every
 * failure path, following `staff/audit/actions.ts`'s ok/message result
 * shape. Neither action touches the `Notification` table from the
 * preferences side or the `EmailPreference` table from the mark-read side,
 * so a muted category can never suppress the in-product notification and
 * marking read can never change a preference.
 */

import { z } from "zod";
import { getCurrentActor } from "@/server/auth/current-actor";
import { notificationService } from "@/server/services/notification-service";
import { notificationAccessService } from "@/server/services/notification-access-service";
import {
  emailPreferenceService,
  InvalidPreferenceError,
} from "@/server/services/email-preference-service";
import { MUTABLE_EMAIL_CATEGORIES } from "@/server/communications/contracts";

const NOT_SIGNED_IN_MESSAGE = "Sign in to continue.";

export type MarkAllNotificationsReadResult =
  | { ok: true; count: number }
  | { ok: false; message: string };

export async function markAllNotificationsReadAction(): Promise<MarkAllNotificationsReadResult> {
  const actor = await getCurrentActor();
  if (!actor) {
    return { ok: false, message: NOT_SIGNED_IN_MESSAGE };
  }

  try {
    const count = await notificationService.markAllRead(actor);
    return { ok: true, count };
  } catch (error) {
    console.error("markAllNotificationsReadAction failed", error);
    return { ok: false, message: "Could not mark notifications read. Try again." };
  }
}

const PREFERENCES_NOT_SAVED_MESSAGE = "Preferences not saved. Try again.";

const savePreferencesSchema = z
  .object({
    muted: z
      .array(z.enum(MUTABLE_EMAIL_CATEGORIES))
      .max(MUTABLE_EMAIL_CATEGORIES.length)
      .refine((values) => new Set(values).size === values.length, {
        message: "Duplicate category.",
      }),
  })
  .strict();

export type SaveEmailPreferencesResult =
  | { ok: true; muted: string[] }
  | { ok: false; message: string };

export async function saveEmailPreferencesAction(
  input: unknown,
): Promise<SaveEmailPreferencesResult> {
  const parsed = savePreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: PREFERENCES_NOT_SAVED_MESSAGE };
  }

  const actor = await getCurrentActor();
  if (!actor) {
    return { ok: false, message: PREFERENCES_NOT_SAVED_MESSAGE };
  }

  try {
    const muted = await emailPreferenceService.saveMutedCategories(actor, parsed.data.muted);
    return { ok: true, muted };
  } catch (error) {
    if (error instanceof InvalidPreferenceError) {
      return { ok: false, message: PREFERENCES_NOT_SAVED_MESSAGE };
    }
    console.error("saveEmailPreferencesAction failed", error);
    return { ok: false, message: PREFERENCES_NOT_SAVED_MESSAGE };
  }
}

/**
 * Opens a notification (D-19, D-21). The destination's own access rule is
 * re-checked server-side (`notificationAccessService.resolveOpen`) before
 * any href is returned; a stale, foreign or forbidden target reports the
 * exact same `{ ok: true, unavailable: true }` shape as a genuinely deleted
 * one, and any failure to even authenticate falls back to the one generic
 * failure message below — never a distinct reason or status.
 */
const OPEN_NOTIFICATION_FAILURE_MESSAGE = "Could not open notification. Try again.";

const openNotificationSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
  })
  .strict();

export type OpenNotificationResult =
  | { ok: true; unavailable: false; href: string }
  | { ok: true; unavailable: true }
  | { ok: false; message: string };

export async function openNotificationAction(input: unknown): Promise<OpenNotificationResult> {
  const parsed = openNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: OPEN_NOTIFICATION_FAILURE_MESSAGE };
  }

  const actor = await getCurrentActor();
  if (!actor) {
    return { ok: false, message: OPEN_NOTIFICATION_FAILURE_MESSAGE };
  }

  const outcome = await notificationAccessService.resolveOpen(actor, parsed.data.id);
  if (outcome.status === "ok") {
    return { ok: true, unavailable: false, href: outcome.href };
  }
  return { ok: true, unavailable: true };
}
