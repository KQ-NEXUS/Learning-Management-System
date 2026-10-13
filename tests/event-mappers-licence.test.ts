/**
 * Phase 14 plan 14-14: the `licence.notice` mapper (LIC-07, D-15, prohibition
 * P5). `resolveStaffHolders` is mocked so the tests can assert exactly which
 * permission and scope the mapper asks for; the real-Postgres proof of who
 * actually receives a notice lives in `tests/licence-drain.integration.test.ts`.
 *
 * `event-intent-mappers.ts` is imported FIRST (a real value import), for the
 * same circular-import load-order reason `tests/event-mappers-staff.test.ts`
 * documents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const resolveStaffHolders = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/staff-recipient-service", () => ({ resolveStaffHolders }));

import {
  buildMapperTable,
  EVENT_MAPPER_GROUPS,
  MalformedEventError,
} from "@/server/services/event-intent-mappers";
import type { DrainEvent, EventMapper, MapperContext } from "@/server/services/event-intent-mappers";
import { createLicenceMappers } from "@/server/services/event-mappers/licence";
import { buildCorrelationId } from "@/server/communications/contracts";
import { renderNotificationText } from "@/server/communications/notification-text";
import { renderEmail } from "@/server/email/templates/registry";
import { STAFF_TEMPLATES } from "@/server/email/templates/staff-templates";
import { EMAIL_FOOTER_REASON } from "@/server/email/templates/layout";
import { noticeCopy } from "@/server/licence/policy";
import { createLicenceNoticeService } from "@/server/services/licence-notice-service";
import type { DomainEventCreateManyClient } from "@/server/services/domain-event-service";
import type { LicenceStatusSnapshot } from "@/server/licence/types";

const NOW = new Date("2026-10-02T09:00:00.000Z");
const mapper = createLicenceMappers()["licence.notice"] as EventMapper;

function makeEvent(payload: Record<string, unknown>, id = "licence:L1:expired"): DrainEvent {
  return { id, type: "licence.notice", payload, occurredAt: NOW };
}

function makeCtx(): MapperContext {
  return { tx: {} as unknown as Prisma.TransactionClient, now: () => NOW };
}

beforeEach(() => {
  resolveStaffHolders.mockReset().mockResolvedValue(["holder-a", "holder-b"]);
  vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
  vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
  vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
  vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("licence.notice mapper (Task 1 tracer)", () => {
  it("returns a notification and an email per holder, resolved over Global licence.view only", async () => {
    const event = makeEvent({
      licenceId: "L1",
      noticeKey: "expired",
      state: "GRACE",
      expiry: "30 Sep 2026, 23:59 WAT",
      graceEnd: "14 Oct 2026, 23:59 WAT",
    });

    const intents = await mapper(event, makeCtx());

    expect(resolveStaffHolders).toHaveBeenCalledTimes(1);
    expect(resolveStaffHolders.mock.calls[0]![1]).toEqual({ permission: "licence.view", scope: {} });
    const copy = noticeCopy("expired", { graceEnd: "14 Oct 2026, 23:59 WAT" });
    expect(intents).toEqual(
      ["holder-a", "holder-b"].map((holderId) => ({
        recipientUserId: holderId,
        email: {
          template: "staff-licence-notice",
          params: {
            headline: copy.emailHeadline,
            detail: copy.emailDetail,
            licencePath: "/staff/licence",
          },
          correlationId: buildCorrelationId(event.id, holderId),
        },
        notification: {
          type: "staff.licence_notice",
          targetType: "STAFF_LICENCE",
          targetId: "L1",
          params: {
            noticeKey: "expired",
            expiry: "30 Sep 2026, 23:59 WAT",
            graceEnd: "14 Oct 2026, 23:59 WAT",
          },
        },
      })),
    );
  });

  it("omits the email for expiring-60 and keeps the notification", async () => {
    const intents = await mapper(
      makeEvent({ licenceId: "L1", noticeKey: "expiring-60", state: "EXPIRING_SOON", days: "60" }, "licence:L1:expiring-60"),
      makeCtx(),
    );

    expect(intents).toHaveLength(2);
    for (const intent of intents) {
      expect(intent.email).toBeUndefined();
      expect(intent.notification).toMatchObject({
        type: "staff.licence_notice",
        targetType: "STAFF_LICENCE",
        params: { noticeKey: "expiring-60", days: "60" },
      });
    }
  });

  it("sends an email for expiring-30 (every notice except expiring-60 is mailed)", async () => {
    const intents = await mapper(
      makeEvent({ licenceId: "L1", noticeKey: "expiring-30", state: "EXPIRING_SOON", days: "30" }, "licence:L1:expiring-30"),
      makeCtx(),
    );
    expect(intents.every((intent) => intent.email?.template === "staff-licence-notice")).toBe(true);
  });

  it("throws MalformedEventError for an unknown or missing notice key, before resolving recipients", async () => {
    await expect(mapper(makeEvent({ licenceId: "L1", noticeKey: "bogus" }), makeCtx())).rejects.toBeInstanceOf(
      MalformedEventError,
    );
    await expect(mapper(makeEvent({ licenceId: "L1" }), makeCtx())).rejects.toBeInstanceOf(MalformedEventError);
    await expect(mapper(makeEvent({ licenceId: "L1", noticeKey: 5 }), makeCtx())).rejects.toBeInstanceOf(
      MalformedEventError,
    );
    expect(resolveStaffHolders).not.toHaveBeenCalled();
  });

  it("registers exactly one mapper for licence.notice in the live table", () => {
    const table = buildMapperTable(EVENT_MAPPER_GROUPS);
    expect(table["licence.notice"]).toHaveLength(1);
    expect(Object.keys(createLicenceMappers())).toEqual(["licence.notice"]);
  });
});

// ---------------------------------------------------------------------------
// Task 2: notice-key coverage, allow-listed params and the content prohibition
// ---------------------------------------------------------------------------

const ALL_KEYS = [
  "expiring-60",
  "expiring-30",
  "expiring-14",
  "expiring-7",
  "expiring-3",
  "expiring-1",
  "expired",
  "grace-ending",
  "restricted",
  "invalid-BAD_SIGNATURE",
  "invalid-WRONG_DEPLOYMENT",
  "validation-attention-1790000000",
  "clock-rollback-2026-10-01T14",
] as const;

const SECRET_DEPLOYMENT_ID = "fixture-deployment-0001";
const SECRET_KEY_ID = "kid-secret-1";
const SECRET_CLIENT = "Fixture Training Academy";
const SECRET_LICENCE_TEXT = "LMS-LIC1.aGVhZGVy.cGF5bG9hZA.c2lnbmF0dXJl";

function fullSnapshot(): LicenceStatusSnapshot {
  return {
    state: "GRACE",
    reasonCode: "BAD_SIGNATURE",
    isRestricted: false,
    everActivated: true,
    licenceId: "L1",
    keyId: SECRET_KEY_ID,
    schemaVersion: 1,
    clientName: SECRET_CLIENT,
    deploymentId: SECRET_DEPLOYMENT_ID,
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-30T22:59:59.000Z"),
    graceEndsAt: new Date("2026-10-14T22:59:59.000Z"),
    timeZone: "Africa/Lagos",
    support: { renewalEmail: "renew@fixture.test", supportEmail: "support@fixture.test", phone: null, hours: null },
    restrictedAt: null,
    daysRemaining: 29,
    daysToGraceEnd: 3,
    underOneDay: false,
    lastVerifiedAt: NOW,
    lastVerificationOutcome: "OK",
    attentionSince: null,
    clockAlertAt: null,
    highWaterAt: null,
    evaluatedAt: NOW,
  };
}

/** Emits `key` through the real service over a recording fake and returns the stored payload. */
async function emittedPayload(key: string): Promise<Record<string, unknown>> {
  let stored: Record<string, unknown> = {};
  const client = {
    domainEvent: {
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        stored = args.data[0]!.payload as Record<string, unknown>;
        return { count: 1 };
      },
    },
  } as DomainEventCreateManyClient;
  await createLicenceNoticeService({ db: client, now: () => NOW }).emitNotices({
    snapshot: fullSnapshot(),
    noticeKeys: [key],
  });
  return stored;
}

describe("every notice key renders through the real text and email layers (Test 1)", () => {
  it.each(ALL_KEYS)("%s: notification title and email subject agree with the UI-SPEC copy", async (key) => {
    const payload = await emittedPayload(key);
    const intents = await mapper(makeEvent(payload, `licence:L1:${key}`), makeCtx());
    expect(intents).toHaveLength(2);

    for (const intent of intents) {
      const notification = intent.notification!;
      const text = renderNotificationText(notification.type, notification.params);
      const copy = noticeCopy(key, {
        days: payload.days as string | undefined,
        expiry: payload.expiry as string | undefined,
        graceEnd: payload.graceEnd as string | undefined,
      });
      expect(text.title).toBe(copy.title);
      expect(text.title).not.toBe("Licence status update");

      if (key === "expiring-60") {
        expect(intent.email).toBeUndefined();
        continue;
      }
      const email = intent.email!;
      const rendered = renderEmail("staff-licence-notice", email.params as Parameters<typeof renderEmail<"staff-licence-notice">>[1]);
      expect(rendered.subject).toBe(text.title);
    }
  });
});

describe("content prohibition (Test 2, P5, T-14-14-02)", () => {
  const FORBIDDEN_FIELDS = ["deploymentId", "signature", "privateKey", "client", "contract"];
  const SECRET_VALUES = [SECRET_DEPLOYMENT_ID, SECRET_KEY_ID, SECRET_CLIENT, SECRET_LICENCE_TEXT, "fixture.test"];

  /** Whole-word, case-insensitive match, so "this deployment" is found but "deploymentId" is not a word. */
  const hasWord = (haystack: string, word: string): boolean =>
    new RegExp(`\\b${word}\\b`, "i").test(haystack);

  /** Strips the shared layout footer (the Phase 13 footer is not licence copy). */
  const withoutFooter = (value: string): string => value.split(EMAIL_FOOTER_REASON).join("");

  it.each(ALL_KEYS)("%s: payload, params and rendered email carry no signing, contract, key or deployment detail", async (key) => {
    const payload = await emittedPayload(key);
    const intents = await mapper(makeEvent(payload, `licence:L1:${key}`), makeCtx());
    const intent = intents[0]!;

    const payloadJson = JSON.stringify(payload);
    const notificationJson = JSON.stringify(intent.notification!.params);
    // Field names are matched case-sensitively: the closed reason codes
    // (BAD_SIGNATURE, WRONG_DEPLOYMENT) are upper-case codes, not signing material.
    for (const forbidden of FORBIDDEN_FIELDS) {
      expect(payloadJson).not.toContain(forbidden);
      expect(notificationJson).not.toContain(forbidden);
    }
    for (const secret of SECRET_VALUES) {
      expect(payloadJson).not.toContain(secret);
      expect(notificationJson).not.toContain(secret);
    }
    expect(Object.keys(payload).every((field) =>
      ["licenceId", "noticeKey", "state", "days", "expiry", "graceEnd", "reasonCode"].includes(field))).toBe(true);
    expect(Object.keys(intent.notification!.params).every((field) =>
      ["noticeKey", "days", "expiry", "graceEnd"].includes(field))).toBe(true);

    if (!intent.email) return;
    const emailParamsJson = JSON.stringify(intent.email.params);
    for (const forbidden of FORBIDDEN_FIELDS) expect(emailParamsJson).not.toContain(forbidden);
    for (const secret of SECRET_VALUES) expect(emailParamsJson).not.toContain(secret);
    expect(Object.keys(intent.email.params).sort()).toEqual(["detail", "headline", "licencePath"]);

    const params = intent.email.params as Parameters<typeof renderEmail<"staff-licence-notice">>[1];
    const rendered = renderEmail("staff-licence-notice", params);
    const authored = JSON.stringify(STAFF_TEMPLATES["staff-licence-notice"](params));
    for (const surface of [withoutFooter(rendered.text), withoutFooter(rendered.html), authored]) {
      expect(hasWord(surface, "key")).toBe(false);
      expect(hasWord(surface, "signature")).toBe(false);
      expect(hasWord(surface, "contract")).toBe(false);
      for (const secret of SECRET_VALUES) expect(surface).not.toContain(secret);
      // The word "deployment" may only appear as the plain-prose phrase "this
      // deployment" from the approved copy; a deployment identifier never does.
      expect(surface.replace(/this deployment/gi, "")).not.toMatch(/\bdeployment\b/i);
    }
  });
});

describe("recipients (Test 3)", () => {
  it("returns no intents when no staff member holds licence.view, and asks no other source", async () => {
    resolveStaffHolders.mockResolvedValue([]);
    const intents = await mapper(makeEvent({ licenceId: "L1", noticeKey: "restricted", state: "RESTRICTED_CONTINUITY" }), makeCtx());
    expect(intents).toEqual([]);
    expect(resolveStaffHolders).toHaveBeenCalledTimes(1);
  });

  it("builds one correlation id per holder from the event id", async () => {
    const event = makeEvent({ licenceId: "L1", noticeKey: "restricted", state: "RESTRICTED_CONTINUITY" }, "licence:L1:restricted");
    const intents = await mapper(event, makeCtx());
    expect(intents.map((i) => i.email!.correlationId)).toEqual([
      buildCorrelationId(event.id, "holder-a"),
      buildCorrelationId(event.id, "holder-b"),
    ]);
    expect(new Set(intents.map((i) => i.email!.correlationId)).size).toBe(2);
  });
});

describe("days and param types (Test 4)", () => {
  it("expiring-30 carries days 30 and grace-ending carries the payload days string; params are strings only", async () => {
    const [expiring] = await mapper(
      makeEvent({ licenceId: "L1", noticeKey: "expiring-30", state: "EXPIRING_SOON", days: "30" }),
      makeCtx(),
    );
    expect(expiring!.notification!.params.days).toBe("30");

    const [grace] = await mapper(
      makeEvent({ licenceId: "L1", noticeKey: "grace-ending", state: "GRACE", days: "2", graceEnd: "14 Oct 2026, 23:59 WAT" }),
      makeCtx(),
    );
    expect(grace!.notification!.params.days).toBe("2");
    expect(renderNotificationText("staff.licence_notice", grace!.notification!.params).title).toBe(
      "Grace period ends in 2 days",
    );

    for (const intent of [expiring!, grace!]) {
      for (const value of Object.values(intent.notification!.params)) expect(typeof value).toBe("string");
    }
  });

  it("ignores a non-string payload value and never spreads unknown payload members into params", async () => {
    const [intent] = await mapper(
      makeEvent({
        licenceId: "L1",
        noticeKey: "expiring-14",
        state: "EXPIRING_SOON",
        days: 14,
        deploymentId: SECRET_DEPLOYMENT_ID,
        signature: "abc",
      }),
      makeCtx(),
    );
    expect(intent!.notification!.params).toEqual({ noticeKey: "expiring-14" });
    expect(JSON.stringify(intent)).not.toContain(SECRET_DEPLOYMENT_ID);
    expect(JSON.stringify(intent)).not.toContain("abc");
  });

  it("targets none when the payload has no licence id", async () => {
    const [intent] = await mapper(
      makeEvent({ noticeKey: "clock-rollback-2026-10-01T14", state: "UNLICENSED" }, "licence:none:clock-rollback-2026-10-01T14"),
      makeCtx(),
    );
    expect(intent!.notification!.targetId).toBe("none");
  });
});
