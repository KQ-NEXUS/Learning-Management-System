/**
 * Phase 14 plan 14-08 tracer: the licence notice vocabulary across the Phase 13
 * communications contracts, notification text, links, email template, access
 * resolver and the once-only domain event writer (D-15, LIC-07).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOMAIN_EVENT_TYPE_LIST,
  EMAIL_CATEGORY,
  MUTABLE_EMAIL_CATEGORIES,
  NOTIFICATION_TYPE_TARGET,
  TEMPLATE_CATEGORY,
} from "@/server/communications/contracts";
import { LICENCE_PATH, notificationHref } from "@/server/communications/links";
import { renderNotificationText } from "@/server/communications/notification-text";
import { renderEmail, TEMPLATE_SAMPLES } from "@/server/email/templates/registry";
import { STAFF_SAMPLES, STAFF_TEMPLATES } from "@/server/email/templates/staff-templates";
import { createStaffLicenceResolver } from "@/server/services/notification-access-service";
import {
  writeDomainEventOnce,
  type DomainEventCreateManyClient,
} from "@/server/services/domain-event-service";
import { noticeCopy } from "@/server/licence/policy";

beforeEach(() => {
  vi.stubEnv("EMAIL_SENDER_NAME", "Acme Academy");
  vi.stubEnv("EMAIL_SENDER_ADDRESS", "no-reply@acme.test");
  vi.stubEnv("SUPPORT_CONTACT_EMAIL", "help@acme.test");
  vi.stubEnv("APP_BASE_URL", "https://lms.acme.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("licence notice contracts (Test 1)", () => {
  it("registers the event type, the notification target and the STAFF template category", () => {
    expect(DOMAIN_EVENT_TYPE_LIST).toContain("licence.notice");
    expect(NOTIFICATION_TYPE_TARGET["staff.licence_notice"]).toBe("STAFF_LICENCE");
    expect(TEMPLATE_CATEGORY["staff-licence-notice"]).toBe("STAFF");
  });

  it("never lets a recipient mute the STAFF category", () => {
    expect(TEMPLATE_CATEGORY["staff-licence-notice"]).toBe(EMAIL_CATEGORY.STAFF);
    expect((MUTABLE_EMAIL_CATEGORIES as readonly string[]).includes("STAFF")).toBe(false);
  });
});

describe("licence notice link (Test 2)", () => {
  it("opens /staff/licence regardless of the target id", () => {
    expect(LICENCE_PATH).toBe("/staff/licence");
    expect(notificationHref("STAFF_LICENCE", "anything")).toBe("/staff/licence");
  });
});

describe("licence notice text (Test 3, T-14-08-01)", () => {
  it("renders the title and meta from the closed copy set and drops non-allow-listed params", () => {
    const out = renderNotificationText("staff.licence_notice", {
      noticeKey: "expiring-30",
      days: "30",
      expiry: "30 Nov 2026, 23:59 WAT",
      secret: "x",
    });
    expect(out).toEqual({
      title: "Licence expires in 30 days",
      meta: "Expires 30 Nov 2026, 23:59 WAT",
    });
  });

  it("renders the generic title for an unknown key and never echoes it", () => {
    const out = renderNotificationText("staff.licence_notice", { noticeKey: "evil-<b>key</b>" });
    expect(out.title).toBe("Licence status update");
    expect(JSON.stringify(out)).not.toContain("evil");
  });

  it("renders the generic title when no key is supplied", () => {
    expect(renderNotificationText("staff.licence_notice", {}).title).toBe("Licence status update");
  });

  it("drops a numeric days value (strings only)", () => {
    const out = renderNotificationText("staff.licence_notice", {
      noticeKey: "expiring-30",
      days: 5,
      expiry: "30 Nov 2026, 23:59 WAT",
    });
    // The numeric 5 is dropped, so the bucket default (30) is used.
    expect(out.title).toBe("Licence expires in 30 days");
  });
});

describe("licence notice email (Test 4, T-14-08-02)", () => {
  const sample = STAFF_SAMPLES["staff-licence-notice"];

  it("has a registered sample and renders with the subject equal to the headline", () => {
    expect(TEMPLATE_SAMPLES["staff-licence-notice"]).toEqual(sample);
    const out = renderEmail("staff-licence-notice", sample);
    expect(out.subject).toBe(sample.headline);
    expect(out.html).toContain('href="https://lms.acme.test/staff/licence"');
    expect(out.text.split("\n")).toContain("https://lms.acme.test/staff/licence");
    expect(out.html).toContain("Review licence");
  });

  it("subject equals the notification title for the same notice key", () => {
    const copy = noticeCopy("expiring-30", { days: "30", expiry: "30 Nov 2026, 23:59 WAT" });
    const out = renderEmail("staff-licence-notice", {
      headline: copy.emailHeadline,
      detail: copy.emailDetail,
      licencePath: LICENCE_PATH,
    });
    const text = renderNotificationText("staff.licence_notice", {
      noticeKey: "expiring-30",
      days: "30",
      expiry: "30 Nov 2026, 23:59 WAT",
    });
    expect(out.subject).toBe(text.title);
  });

  it("has no whole-word deployment or key in the template-authored parts", () => {
    const content = STAFF_TEMPLATES["staff-licence-notice"](sample);
    const authored = [content.subject, content.heading, ...content.paragraphs, content.button?.label ?? ""].join(
      " ",
    );
    expect(authored).not.toMatch(/\bdeployment\b/i);
    expect(authored).not.toMatch(/\bkey\b/i);
  });

  it("carries no signing or key wording in any notice email headline or detail", () => {
    for (const noticeKey of [
      "expiring-60",
      "expiring-1",
      "expired",
      "grace-ending",
      "restricted",
      "invalid-BAD_SIGNATURE",
      "validation-attention",
      "clock-rollback",
    ]) {
      const copy = noticeCopy(noticeKey, {});
      expect(`${copy.emailHeadline} ${copy.emailDetail}`, noticeKey).not.toMatch(/\bkey\b|signing|contract/i);
    }
  });
});

describe("createStaffLicenceResolver (Test 5, T-14-08-03)", () => {
  const actor = { userId: "user-1" };

  it("allows when can(licence.view, {}) is true", async () => {
    const can = vi.fn().mockResolvedValue(true);
    expect(await createStaffLicenceResolver(can)(actor, "anything", {})).toBe(true);
    expect(can).toHaveBeenCalledWith("licence.view", {});
  });

  it("denies when can(licence.view, {}) is false", async () => {
    const can = vi.fn().mockResolvedValue(false);
    expect(await createStaffLicenceResolver(can)(actor, "anything", {})).toBe(false);
  });
});

describe("writeDomainEventOnce (Test 6, T-14-08-04)", () => {
  function fakeClient(count: number) {
    const createMany = vi.fn().mockResolvedValue({ count });
    return { client: { domainEvent: { createMany } } as DomainEventCreateManyClient, createMany };
  }

  it("inserts once with the supplied id and skipDuplicates, and reports a created row", async () => {
    const { client, createMany } = fakeClient(1);
    const created = await writeDomainEventOnce(client, {
      id: "licence-notice:LIC-1:expiring-30",
      type: "licence.notice",
      payload: { licenceId: "LIC-1", noticeKey: "expiring-30" },
    });
    expect(created).toBe(true);
    expect(createMany).toHaveBeenCalledTimes(1);
    const args = createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(1);
    expect(args.data[0]).toMatchObject({
      id: "licence-notice:LIC-1:expiring-30",
      type: "licence.notice",
      payload: { licenceId: "LIC-1", noticeKey: "expiring-30" },
    });
    expect(args.data[0].occurredAt).toBeInstanceOf(Date);
  });

  it("reports false when the id already existed", async () => {
    const { client } = fakeClient(0);
    expect(
      await writeDomainEventOnce(client, { id: "dup", type: "licence.notice", payload: {} }),
    ).toBe(false);
  });

  it("redacts secrets in the payload like writeDomainEvent", async () => {
    const { client, createMany } = fakeClient(1);
    await writeDomainEventOnce(client, {
      id: "x",
      type: "licence.notice",
      payload: { noticeKey: "restricted", password: "hunter2" },
    });
    expect(JSON.stringify(createMany.mock.calls[0][0].data)).not.toContain("hunter2");
  });
});
