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
