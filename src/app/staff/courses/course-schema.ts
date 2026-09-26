/**
 * Zod schemas for the Course create / edit Server Actions.
 *
 * Kept out of `actions.ts` because a `"use server"` file may only export async
 * functions; a schema object exported from there would break the build.
 *
 * Both schemas are `.strict()` (T-11-82): an unknown key is rejected rather
 * than silently dropped, so a forged FormData can never smuggle `status`,
 * `slugLockedAt` or `publiclyListed` towards the service.
 */

import { z } from "zod";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const title = z.string().trim().min(1, "Enter a course title.").max(200);
const slug = z
  .string()
  .trim()
  .min(1, "Enter a slug.")
  .max(120)
  .regex(SLUG, "Use lowercase letters, numbers and single hyphens.");

export const createCourseSchema = z
  .object({
    title,
    slug,
    summary: z.string().trim().max(2000).optional(),
    outcomes: z.string().trim().max(4000).optional(),
    audience: z.string().trim().max(2000).optional(),
    prerequisites: z.string().trim().max(4000).optional(),
    durationHours: z.coerce.number().int().min(0).max(10_000).optional(),
    certificateEnabled: z.boolean().default(false),
    requirePassingAssessments: z.boolean().default(false),
    // Both certificate-settings fields are absent from FormData entirely when
    // `certificateEnabled` is unchecked — the controls render `disabled` and a
    // disabled input is never submitted (plan 11-08). `.optional()` on both is
    // therefore load-bearing, not a shortcut: a required enum here would reject
    // every "certificates off" submission.
    certificateIssuanceMode: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
    certificateTemplateId: z.string().min(1).nullable().optional(),
  })
  .strict();

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/**
 * Update payload. Blank optional text arrives as `null` (clear the column);
 * an absent certificate control arrives as `undefined` (leave unchanged).
 * `durationHours` is parsed WITHOUT coercion because `z.coerce.number()` turns
 * `null` into `0`; the action maps a blank input to `null` before parsing.
 */
export const updateCourseSchema = z
  .object({
    courseId: z.string().min(1),
    title,
    slug,
    summary: optionalText(2000),
    outcomes: optionalText(4000),
    audience: optionalText(2000),
    prerequisites: optionalText(4000),
    durationHours: z
      .number("Enter a whole number of hours.")
      .int("Enter a whole number of hours.")
      .min(0, "Duration cannot be negative.")
      .max(10_000)
      .nullable()
      .optional(),
    certificateEnabled: z.boolean(),
    requirePassingAssessments: z.boolean().default(false),
    certificateIssuanceMode: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
    certificateTemplateId: z.string().min(1).nullable().optional(),
  })
  .strict();

/**
 * The form's "Learners must pass required assessments" box maps onto the
 * course's stored completion rule: on is rule v2 with the switch set, off is
 * the default v1 rule. The form never edits raw rule JSON.
 */
export function completionRuleFields(requirePassingAssessments: boolean) {
  return requirePassingAssessments
    ? {
        completionRule: { version: 2, requireAllRequiredLessons: true, requirePassingAssessments: true },
        completionRuleVersion: 2,
      }
    : { completionRule: null, completionRuleVersion: 1 };
}

/** Whether a stored rule already requires passing assessments. */
export function requiresPassingAssessments(completionRule: unknown, completionRuleVersion: number | undefined): boolean {
  return (
    completionRuleVersion === 2 &&
    typeof completionRule === "object" &&
    completionRule !== null &&
    (completionRule as Record<string, unknown>).requirePassingAssessments === true
  );
}

export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
