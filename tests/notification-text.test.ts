/**
 * Unit tests for `notification-text.ts` (D-17, T-13-03): the UI-SPEC title
 * table, the hostile-key allow-list guarantee, and the DTO shaper's
 * Today/Earlier grouping around a real timezone boundary.
 */

import { describe, expect, it } from "vitest";
import { renderNotificationText, toNotificationDto } from "@/server/communications/notification-text";

describe("renderNotificationText — UI-SPEC title table", () => {
  it("enrolment.confirmed", () => {
    expect(renderNotificationText("enrolment.confirmed", {})).toEqual({
      title: "Your enrolment is confirmed",
      meta: null,
    });
  });

  it("session.updated with a course/cohort name", () => {
    expect(
      renderNotificationText("session.updated", { cohortTitle: "Advanced React" }),
    ).toEqual({ title: "Session updated: Advanced React", meta: null });
  });

  it("grade.released with an assessment title", () => {
    expect(
      renderNotificationText("grade.released", { assessmentTitle: "Midterm Quiz" }),
    ).toEqual({ title: "Results released for Midterm Quiz", meta: null });
  });

  it("certificate.issued is static", () => {
    expect(renderNotificationText("certificate.issued", {})).toEqual({
      title: "Certificate issued",
      meta: null,
    });
  });

  it("ticket.reply with a reference", () => {
    expect(renderNotificationText("ticket.reply", { reference: "T-100" })).toEqual({
      title: "Support ticket T-100 has a reply",
      meta: null,
    });
  });

  it("staff.ticket_new with a reference", () => {
    expect(renderNotificationText("staff.ticket_new", { reference: "T-200" })).toEqual({
      title: "New ticket T-200",
      meta: null,
    });
  });

  it("order.payment_exception with an order reference", () => {
    expect(
      renderNotificationText("order.payment_exception", { orderReference: "ORD-1" }),
    ).toEqual({ title: "Payment exception on order ORD-1", meta: null });
  });

  it("staff.email_failed carries no address or body detail", () => {
    expect(
      renderNotificationText("staff.email_failed", { dispatchRef: "dispatch-abc" }),
    ).toEqual({ title: "An email to dispatch-abc could not be delivered.", meta: null });
  });
});

describe("renderNotificationText — safe generic title when a param is missing", () => {
  it("session.updated falls back without an undefined placeholder", () => {
    expect(renderNotificationText("session.updated", {})).toEqual({
      title: "Session updated",
      meta: null,
    });
  });

  it("ticket.reply falls back without a reference", () => {
    expect(renderNotificationText("ticket.reply", null)).toEqual({
      title: "Support ticket has a reply",
      meta: null,
    });
  });

  it("an unrecognised type renders a safe generic title instead of throwing", () => {
    expect(renderNotificationText("not-a-real-type", { reference: "x" })).toEqual({
      title: "You have a new notification",
      meta: null,
    });
  });
});

describe("renderNotificationText — hostile-key allow-list (D-17, T-13-03)", () => {
  it("ignores reason, body and filename entirely", () => {
    const withoutHostileKeys = renderNotificationText("ticket.reply", { reference: "T-100" });
    const withHostileKeys = renderNotificationText("ticket.reply", {
      reference: "T-100",
      reason: "staff decided to redact this",
      body: "the full private message body",
      filename: "secret-attachment.pdf",
    });

    expect(withHostileKeys).toEqual(withoutHostileKeys);
    expect(JSON.stringify(withHostileKeys)).not.toContain("secret");
    expect(JSON.stringify(withHostileKeys)).not.toContain("private message");
  });
});

describe("toNotificationDto", () => {
  it("marks read true/false from readAt and renders the ISO createdAt", () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const unread = toNotificationDto(
      {
        id: "n-1",
        type: "certificate.issued",
        params: {},
        readAt: null,
        createdAt: now,
      },
      now,
    );
    expect(unread.read).toBe(false);
    expect(unread.createdAt).toBe(now.toISOString());

    const read = toNotificationDto(
      {
        id: "n-2",
        type: "certificate.issued",
        params: {},
        readAt: now,
        createdAt: now,
      },
      now,
    );
    expect(read.read).toBe(true);
  });

  it("groups 'today' and 'earlier' by the app timezone (Africa/Lagos, UTC+1) calendar date", () => {
    // now: 2026-01-15T12:00:00Z = 2026-01-15 13:00 Lagos.
    const now = new Date("2026-01-15T12:00:00.000Z");
    // sameLagosDay: 2026-01-14T23:30:00Z = 2026-01-15 00:30 Lagos -> today.
    const sameLagosDay = new Date("2026-01-14T23:30:00.000Z");
    // previousLagosDay: 2026-01-14T22:30:00Z = 2026-01-14 23:30 Lagos -> earlier.
    const previousLagosDay = new Date("2026-01-14T22:30:00.000Z");

    const today = toNotificationDto(
      { id: "n-1", type: "certificate.issued", params: {}, readAt: null, createdAt: sameLagosDay },
      now,
    );
    const earlier = toNotificationDto(
      {
        id: "n-2",
        type: "certificate.issued",
        params: {},
        readAt: null,
        createdAt: previousLagosDay,
      },
      now,
    );

    expect(today.group).toBe("today");
    expect(earlier.group).toBe("earlier");
  });
});

describe("renderNotificationText — staff.licence_notice (LIC-07, T-14-08-01)", () => {
  const expiry = "30 Nov 2026, 23:59 WAT";
  const graceEnd = "14 Dec 2026, 23:59 WAT";
  const base = { days: "30", expiry, graceEnd };

  it("expiring-30 renders the days title and expiry meta", () => {
    expect(renderNotificationText("staff.licence_notice", { ...base, noticeKey: "expiring-30" })).toEqual({
      title: "Licence expires in 30 days",
      meta: `Expires ${expiry}`,
    });
  });

  it("expiring-1 renders the tomorrow title", () => {
    expect(renderNotificationText("staff.licence_notice", { ...base, noticeKey: "expiring-1" })).toEqual({
      title: "Licence expires tomorrow",
      meta: `Expires ${expiry}`,
    });
  });

  it("expired renders the grace-started title with the grace end", () => {
    expect(renderNotificationText("staff.licence_notice", { ...base, noticeKey: "expired" })).toEqual({
      title: "Licence expired: grace period has started",
      meta: `Normal operation continues until ${graceEnd}`,
    });
  });

  it("grace-ending renders the grace countdown", () => {
    expect(
      renderNotificationText("staff.licence_notice", { noticeKey: "grace-ending", days: "3", graceEnd }),
    ).toEqual({
      title: "Grace period ends in 3 days",
      meta: `Restricted continuity mode begins ${graceEnd}`,
    });
  });

  it("restricted renders the restricted title and fixed meta", () => {
    expect(renderNotificationText("staff.licence_notice", { noticeKey: "restricted" })).toEqual({
      title: "Restricted continuity mode is now active",
      meta: "New enrolments and checkout are blocked",
    });
  });

  it("invalid-BAD_SIGNATURE renders the fixed rejection sentence, not the code", () => {
    const out = renderNotificationText("staff.licence_notice", { noticeKey: "invalid-BAD_SIGNATURE" });
    expect(out.title).toBe("Licence could not be verified");
    expect(out.meta).toContain("signature");
    expect(JSON.stringify(out)).not.toContain("BAD_SIGNATURE");
  });

  it("validation-attention renders the check-pending title", () => {
    expect(
      renderNotificationText("staff.licence_notice", { noticeKey: "validation-attention-20261130" }),
    ).toEqual({
      title: "Licence check could not complete",
      meta: "Last known state kept for up to 24 hours",
    });
  });

  it("clock-rollback renders the clock title", () => {
    expect(
      renderNotificationText("staff.licence_notice", { noticeKey: "clock-rollback-2026-11-30T10" }),
    ).toEqual({
      title: "Server clock moved backwards",
      meta: "Check the server time settings",
    });
  });

  it("never echoes a reason, the raw key or a non-allow-listed param", () => {
    const keys = [
      "expiring-30",
      "expiring-1",
      "expired",
      "grace-ending",
      "restricted",
      "invalid-BAD_SIGNATURE",
      "validation-attention-20261130",
      "clock-rollback-2026-11-30T10",
      "unknown-key-xyz",
    ];
    for (const noticeKey of keys) {
      const out = renderNotificationText("staff.licence_notice", {
        ...base,
        noticeKey,
        reason: "SECRET-REASON",
        deploymentId: "SECRET-DEPLOYMENT",
      });
      const text = `${out.title} ${out.meta ?? ""}`;
      expect(text, noticeKey).not.toMatch(/reason/i);
      expect(text, noticeKey).not.toContain("SECRET");
      // Plain words such as "expired" legitimately occur in a title; the raw
      // machine key (hyphenated or suffixed identifier) must never appear.
      if (/[-_0-9]/.test(noticeKey) && noticeKey !== "expiring-1") {
        expect(text, noticeKey).not.toContain(noticeKey);
      }
    }
  });
});
