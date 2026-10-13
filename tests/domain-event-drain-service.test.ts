/**
 * Pure unit coverage for the drain's two exported helpers (D-11, D-16, D-19,
 * D-04, T-13-32) — no database needed, since both are total functions of
 * their inputs. Real-Postgres proof of the transaction/poison/recipient
 * machinery that USES these helpers lives in
 * `tests/domain-event-drain.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  decideEmailDisposition,
  safeErrorSummary,
} from "@/server/services/domain-event-drain-service";
import { EMAIL_CATEGORY, MUTABLE_EMAIL_CATEGORIES, type EmailCategory } from "@/server/communications/contracts";

const ALL_CATEGORIES = Object.values(EMAIL_CATEGORY) as EmailCategory[];
const VERIFIED = new Date("2026-01-01T00:00:00.000Z");

describe("decideEmailDisposition (D-11, D-16, D-19)", () => {
  it("covers all seven EMAIL_CATEGORY values", () => {
    expect(ALL_CATEGORIES).toHaveLength(7);
  });

  it.each(ALL_CATEGORIES)("%s: a DEACTIVATED user is always SKIPPED recipient_deactivated", (category) => {
    expect(
      decideEmailDisposition({
        userStatus: "DEACTIVATED",
        emailVerified: VERIFIED,
        category,
        mutedCategories: new Set(),
      }),
    ).toEqual({ status: "SKIPPED", reason: "recipient_deactivated" });
  });

  it("AUTH: an unverified ACTIVE user is still QUEUED (a verification mail must reach an unverified address)", () => {
    expect(
      decideEmailDisposition({
        userStatus: "ACTIVE",
        emailVerified: null,
        category: "AUTH",
        mutedCategories: new Set(),
      }),
    ).toEqual({ status: "QUEUED" });
  });

  it.each(ALL_CATEGORIES.filter((category) => category !== "AUTH"))(
    "%s: an unverified ACTIVE user is SKIPPED email_unverified",
    (category) => {
      expect(
        decideEmailDisposition({
          userStatus: "ACTIVE",
          emailVerified: null,
          category,
          mutedCategories: new Set(),
        }),
      ).toEqual({ status: "SKIPPED", reason: "email_unverified" });
    },
  );

  it.each(MUTABLE_EMAIL_CATEGORIES)("%s: muted for an ACTIVE verified user is SKIPPED muted_by_recipient", (category) => {
    expect(
      decideEmailDisposition({
        userStatus: "ACTIVE",
        emailVerified: VERIFIED,
        category,
        mutedCategories: new Set([category]),
      }),
    ).toEqual({ status: "SKIPPED", reason: "muted_by_recipient" });
  });

  it.each(MUTABLE_EMAIL_CATEGORIES)("%s: not muted for an ACTIVE verified user is QUEUED", (category) => {
    expect(
      decideEmailDisposition({
        userStatus: "ACTIVE",
        emailVerified: VERIFIED,
        category,
        mutedCategories: new Set(),
      }),
    ).toEqual({ status: "QUEUED" });
  });

  it.each(ALL_CATEGORIES.filter((category) => !(MUTABLE_EMAIL_CATEGORIES as readonly string[]).includes(category)))(
    "%s: ALWAYS/AUTH/STAFF ignore mutedCategories entirely, even a (malformed) matching entry",
    (category) => {
      expect(
        decideEmailDisposition({
          userStatus: "ACTIVE",
          emailVerified: VERIFIED,
          category,
          mutedCategories: new Set([category, ...MUTABLE_EMAIL_CATEGORIES]),
        }),
      ).toEqual({ status: "QUEUED" });
    },
  );

  it("the mapper's own skip reason always wins, regardless of category or recipient state", () => {
    expect(
      decideEmailDisposition({
        userStatus: "ACTIVE",
        emailVerified: VERIFIED,
        category: "ALWAYS",
        mutedCategories: new Set(),
        mapperSkip: "superseded_by_cohort_cancellation",
      }),
    ).toEqual({ status: "SKIPPED", reason: "superseded_by_cohort_cancellation" });

    expect(
      decideEmailDisposition({
        userStatus: "DEACTIVATED",
        emailVerified: null,
        category: "AUTH",
        mutedCategories: new Set(),
        mapperSkip: "coalesced_into_later_update",
      }),
    ).toEqual({ status: "SKIPPED", reason: "coalesced_into_later_update" });
  });

  it("ENROLMENT_STATUS muted -> SKIPPED muted_by_recipient; the ALWAYS category (e.g. payment-failed) ignores the same mute set", () => {
    const mutedEnrolmentStatus = new Set(["ENROLMENT_STATUS"]);
    expect(
      decideEmailDisposition({
        userStatus: "ACTIVE",
        emailVerified: VERIFIED,
        category: "ENROLMENT_STATUS",
        mutedCategories: mutedEnrolmentStatus,
      }),
    ).toEqual({ status: "SKIPPED", reason: "muted_by_recipient" });

    expect(
      decideEmailDisposition({
        userStatus: "ACTIVE",
        emailVerified: VERIFIED,
        category: "ALWAYS",
        mutedCategories: mutedEnrolmentStatus,
      }),
    ).toEqual({ status: "QUEUED" });
  });
});

describe("safeErrorSummary (T-13-32)", () => {
  it("returns only the error name when there is no code", () => {
    expect(safeErrorSummary(new Error("do not leak this message"))).toBe("Error");
  });

  it("returns the name and code when present, never the message", () => {
    class CodedError extends Error {
      code = "P2002";
      constructor() {
        super("super secret message with a recipient address in it");
        this.name = "CodedError";
      }
    }
    const summary = safeErrorSummary(new CodedError());
    expect(summary).toBe("CodedError:P2002");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("address");
  });

  it("returns a safe fallback name for a non-Error thrown value", () => {
    expect(safeErrorSummary("a plain string throw")).toBe("Error");
    expect(safeErrorSummary(null)).toBe("Error");
    expect(safeErrorSummary(undefined)).toBe("Error");
  });

  it("ignores a non-string, non-number code", () => {
    const err = new Error("message");
    (err as unknown as { code: unknown }).code = { nested: true };
    expect(safeErrorSummary(err)).toBe("Error");
  });
});
