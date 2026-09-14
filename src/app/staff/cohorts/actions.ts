"use server";

/**
 * Cohort create / edit Server Actions.
 *
 * Each is a public POST endpoint (Next.js "Server Actions" guide) — the
 * Origin/Host CSRF check is not authorization. Every action zod-validates and
 * delegates to `cohortService.create` / `updateCohort`, which are gated on
 * `cohorts.manage` at the DB-resolved cohort scope (T-05-76): the page-level
 * authorization catch is presentation only, this is the actual gate.
 *
 * Money is entered and submitted as an integer number of minor units via
 * `z.coerce.number().int()` — never a float-parsing or fixed-decimal
 * formatting call (T-05-77).
 *
 * `priceNgnMinor`/`priceUsdMinor` (D-06/D-08/D-24, 07-05) are each optional
 * and independently nullable — a Cohort may sell on one rail only. Each is
 * validated by a regex-gated decimal-string parse (`minorUnitPriceField`
 * below): the raw FormData string must match `/^\d+$/` before any numeric
 * coercion happens, so `Number(value) * 100` — or any other floating-point
 * path — never runs anywhere in this module (D-24, T-07-25). The legacy
 * `priceMinor`/`currency` NOT-NULL columns are still written on every
 * create/update, mirrored from whichever rail is set (07-11 removes this
 * shim once every reader has migrated to the dual-price fields).
 *
 * The XOR "exactly one of courseId/programmeId" rule is a cross-field zod
 * `superRefine` surfaced with no `path`, so `zodErrors` below routes it to the
 * `offerKind` field and it renders in the `ResourceForm` summary rather than
 * as a single field's error (T-05-78) — the `cohort_targets_exactly_one_offer`
 * DB CHECK is the backstop.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { cohortService, updateCohort, OfferLockedError } from "@/server/services/cohort-service";
import { StaleOrderError } from "@/server/services/reorder-service";
import { isValidTimeZone } from "@/lib/timezone";
import { parseCohortDateTime } from "@/lib/cohort-datetime";

export type CohortFormError = { name: string; message: string };
export type CohortActionResult =
  | { ok: true; id: string }
  | { ok: false; errors: CohortFormError[]; message: string | null };

const DELIVERY_MODES = ["SELF_PACED", "INSTRUCTOR_LED", "BLENDED"] as const;

/** Dates are converted in the submitted cohort zone by `fields`. */
function dateField(label: string) {
  return z.date({ error: `Enter a valid ${label} in the selected timezone.` });
}

/**
 * Decimal-string parsing for one dual-price rail (D-06/D-08/D-24). Optional
 * and nullable: an absent/blank submission means "this Cohort does not sell
 * on this rail" (D-08), never `0`. The raw string is regex-gated to plain
 * digits BEFORE any numeric coercion — `Number(value) * 100` never appears
 * anywhere in this module (T-07-25).
 */
function minorUnitPriceField(fieldLabel: string) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): number | null => {
      if (raw === undefined) return null;
      if (!/^\d+$/.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: raw.trim().startsWith("-")
            ? `${fieldLabel} cannot be negative.`
            : `${fieldLabel} must be a whole number of minor units.`,
        });
        return z.NEVER;
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldLabel} is too large.` });
        return z.NEVER;
      }
      return value;
    });
}

/**
 * The legacy `priceMinor`/`currency` NOT-NULL columns (07-11 removes them).
 * Mirrors whichever dual-price rail is set so the Phase 6 surfaces still
 * reading the legacy pair keep compiling — NGN wins when both rails are
 * set (arbitrary but harmless: nothing derives commercial behaviour from
 * this pair once `startCheckout` reads `priceNgnMinor`/`priceUsdMinor`
 * directly, 07-04). A Cohort with neither rail priced yet (a fresh DRAFT)
 * writes `0`/`NGN` — legal because `priceMinor` carries no CHECK against
 * zero and nothing reads it as a signal until 07-11.
 */
function legacyPriceFields(
  priceNgnMinor: number | null,
  priceUsdMinor: number | null,
): { priceMinor: number; currency: string } {
  if (priceNgnMinor != null) return { priceMinor: priceNgnMinor, currency: "NGN" };
  if (priceUsdMinor != null) return { priceMinor: priceUsdMinor, currency: "USD" };
  return { priceMinor: 0, currency: "NGN" };
}

const baseSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a cohort code.").max(40),
    title: z.string().trim().min(1, "Enter a cohort title.").max(200),
    courseId: z.string().trim().optional(),
    programmeId: z.string().trim().optional(),
    deliveryMode: z.enum(DELIVERY_MODES, { error: "Choose a delivery mode." }),
    timezone: z
      .string()
      .trim()
      .min(1, "Choose a timezone.")
      .refine(isValidTimeZone, "That is not a recognised timezone."),
    startsAt: dateField("the start date"),
    endsAt: dateField("the end date"),
    enrolmentOpensAt: dateField("when enrolment opens"),
    enrolmentClosesAt: dateField("when enrolment closes"),
    // Money is integer minor units — never a float, never a formatted string.
    capacity: z.coerce.number().int("Capacity must be a whole number.").min(1, "Capacity must be at least 1."),
    // D-06/D-08 — two independent, optional, nullable dual-price rails.
    // Neither is required (D-08 permits a one-rail Cohort); the publication
    // gate lives in readiness, not here.
    priceNgnMinor: minorUnitPriceField("NGN price"),
    priceUsdMinor: minorUnitPriceField("USD price"),
    attendanceThresholdPct: z.coerce
      .number()
      .int("Enter a whole percentage.")
      .min(0, "Must be between 0 and 100.")
      .max(100, "Must be between 0 and 100.")
      .optional(),
    // D-02 — default 30. 0 or blank = seat taken only on activation.
    holdMinutes: z.coerce.number().int("Enter a whole number of minutes.").min(0, "Cannot be negative.").optional(),
  })
  .superRefine((data, ctx) => {
    const hasCourse = Boolean(data.courseId);
    const hasProgramme = Boolean(data.programmeId);
    if (hasCourse === hasProgramme) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose exactly one of Course or Programme.",
      });
    }
    if (data.startsAt.getTime() >= data.endsAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "The end date must be after the start date.",
      });
    }
    if (data.enrolmentOpensAt.getTime() >= data.enrolmentClosesAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrolmentClosesAt"],
        message: "Enrolment must close after it opens.",
      });
    }
  });

function fields(form: FormData) {
  const value = (key: string) => {
    const raw = form.get(key);
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const date = (key: string) => {
    const raw = value(key);
    return raw ? parseCohortDateTime(raw, value("timezone") ?? "") ?? undefined : undefined;
  };
  return {
    code: value("code"),
    title: value("title"),
    courseId: value("courseId"),
    programmeId: value("programmeId"),
    deliveryMode: value("deliveryMode"),
    timezone: value("timezone"),
    startsAt: date("startsAt"),
    endsAt: date("endsAt"),
    enrolmentOpensAt: date("enrolmentOpensAt"),
    enrolmentClosesAt: date("enrolmentClosesAt"),
    capacity: value("capacity"),
    priceNgnMinor: value("priceNgnMinor"),
    priceUsdMinor: value("priceUsdMinor"),
    attendanceThresholdPct: value("attendanceThresholdPct"),
    holdMinutes: value("holdMinutes"),
  };
}

/** Cross-field issues (empty `path`) land in the summary via `offerKind`. */
function zodErrors(error: z.ZodError): CohortFormError[] {
  return error.issues.map((issue) => ({
    name: typeof issue.path[0] === "string" ? issue.path[0] : "offerKind",
    message: issue.message,
  }));
}

/**
 * Maps a typed service refusal to the exact UI-SPEC copy. An authorization
 * failure collapses to ONE generic line that does not distinguish "no such
 * cohort" from "not yours" (T-05-80). Anything unrecognised rethrows.
 */
function toFailure(error: unknown): Extract<CohortActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, errors: zodErrors(error), message: null };
  }
  if (error instanceof OfferLockedError) {
    return {
      ok: false,
      errors: [],
      message:
        "The course/programme this cohort delivers is locked because it has enrolments. " +
        "Changing it needs an approved migration.",
    };
  }
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      errors: [],
      message:
        "Someone else changed this cohort while you had it open. Reload to see their version, " +
        "then reapply your changes.",
    };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      errors: [],
      message: "Your role does not permit creating or editing cohorts.",
    };
  }
  throw error;
}

function toCreatePayload(parsed: z.infer<typeof baseSchema>): Record<string, unknown> {
  return {
    code: parsed.code,
    title: parsed.title,
    courseId: parsed.courseId ?? null,
    programmeId: parsed.programmeId ?? null,
    deliveryMode: parsed.deliveryMode,
    timezone: parsed.timezone,
    startsAt: parsed.startsAt,
    endsAt: parsed.endsAt,
    enrolmentOpensAt: parsed.enrolmentOpensAt,
    enrolmentClosesAt: parsed.enrolmentClosesAt,
    capacity: parsed.capacity,
    priceNgnMinor: parsed.priceNgnMinor,
    priceUsdMinor: parsed.priceUsdMinor,
    ...legacyPriceFields(parsed.priceNgnMinor, parsed.priceUsdMinor),
    attendanceThresholdPct: parsed.attendanceThresholdPct ?? null,
    // null/0 both mean "no hold" (D-02) — store the caller's value verbatim.
    holdMinutes: parsed.holdMinutes ?? null,
  };
}

export async function createCohortAction(
  _prev: CohortActionResult,
  form: FormData,
): Promise<CohortActionResult> {
  let id: string | null = null;
  try {
    const parsed = baseSchema.parse(fields(form));
    const created = (await cohortService.create(toCreatePayload(parsed))) as { id: string };
    id = created.id;
  } catch (error) {
    return toFailure(error);
  }
  revalidatePath("/staff/cohorts");
  redirect(`/staff/cohorts/${id}`);
}

const updateSchema = baseSchema.extend({
  cohortId: z.string().min(1),
  // Optimistic-concurrency token — the cohort's `updatedAt` as of page load.
  expectedUpdatedAt: z.iso.datetime().transform((value) => new Date(value)),
});

export async function updateCohortAction(
  _prev: CohortActionResult,
  form: FormData,
): Promise<CohortActionResult> {
  const cohortId = form.get("cohortId");
  const expectedUpdatedAt = form.get("expectedUpdatedAt");
  if (typeof cohortId !== "string" || cohortId === "") {
    return { ok: false, errors: [], message: "Reload the page and try again." };
  }

  try {
    const parsed = updateSchema.parse({
      ...fields(form),
      cohortId,
      expectedUpdatedAt: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : "",
    });

    const data = toCreatePayload(parsed);
    await updateCohort({ id: cohortId, expectedUpdatedAt: parsed.expectedUpdatedAt, data, reason: "Edited from the cohort editor." });
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/staff/cohorts");
  revalidatePath(`/staff/cohorts/${cohortId}`);
  return { ok: true, id: cohortId };
}
