import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Plan 11-23 Task 2 — the Certificates landing page (`/staff/certificates`).
 *
 * UAT test 8 (landing-page half): the pending queue says "Nothing awaiting issuance" once empty,
 * so an automatic issuance left no trace where staff look. The page now also renders a
 * "Recently issued" section (newest 10, SUPERSEDED excluded) with each row's issuance source.
 *
 * Same harness shape as `learner-dashboard-page.test.ts`: the Server Component is invoked
 * directly and rendered with `renderToStaticMarkup` in the node project.
 */

const NOT_FOUND = "NEXT_NOT_FOUND";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    listPendingIssuance: vi.fn(),
    list: vi.fn(),
    listCertificateIssuanceSources: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/server/services/certificate-service", () => ({
  listPendingIssuance: mocks.listPendingIssuance,
  certificateService: { list: mocks.list },
  listCertificateIssuanceSources: mocks.listCertificateIssuanceSources,
}));

import Page from "@/app/staff/certificates/page";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";

function cert(over: Record<string, unknown> = {}) {
  return {
    id: "cert-1",
    enrolmentId: "enr-1",
    userId: "user-1",
    scope: "COURSE",
    courseId: "course-1",
    programmeId: null,
    awardTitle: "Intro to Testing",
    learnerName: "Ada Lovelace",
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    status: "ACTIVE",
    storageKey: "certificates/cert-1",
    verificationRef: "VERIF-0001",
    revokedAt: null,
    revokedById: null,
    revocationReason: null,
    supersedesId: null,
    reviewFlaggedAt: null,
    ...over,
  };
}

async function render() {
  return renderToStaticMarkup(await Page());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listPendingIssuance.mockResolvedValue([]);
  mocks.list.mockResolvedValue([]);
  mocks.listCertificateIssuanceSources.mockResolvedValue({});
});

describe("Certificates landing page", () => {
  it("UAT test 8: an automatic certificate is visible while the queue is empty", async () => {
    mocks.list.mockResolvedValue([cert({ id: "c-auto", learnerName: "Ada Lovelace" })]);
    mocks.listCertificateIssuanceSources.mockResolvedValue({ "c-auto": { kind: "automatic" } });

    const html = await render();

    expect(html).toContain("Nothing awaiting issuance");
    expect(html).toContain("Recently issued");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Automatic");
    expect(html).toContain('href="/staff/certificates/issued/c-auto"');
  });

  it("keeps the header links and the pending queue rendering", async () => {
    const html = await render();
    expect(html).toContain("All certificates");
    expect(html).toContain("Certificate templates");
    expect(mocks.listPendingIssuance).toHaveBeenCalledTimes(1);
  });

  it("shows only the newest 10, newest first, excluding SUPERSEDED, with one source call for those ids", async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      cert({
        id: `c-${i}`,
        learnerName: `Learner ${String(i).padStart(2, "0")}`,
        issuedAt: new Date(Date.UTC(2026, 0, 1 + i)),
      }),
    );
    // c-11 is the newest but superseded, so the newest displayed must be c-10.
    rows[11] = { ...rows[11], status: "SUPERSEDED" };
    // Shuffle to prove the page sorts rather than trusting service order.
    mocks.list.mockResolvedValue([...rows].reverse());

    const html = await render();

    expect(mocks.listCertificateIssuanceSources).toHaveBeenCalledTimes(1);
    const ids = mocks.listCertificateIssuanceSources.mock.calls[0][0].certificateIds;
    expect(ids).toEqual(["c-10", "c-9", "c-8", "c-7", "c-6", "c-5", "c-4", "c-3", "c-2", "c-1"]);
    expect(html).toContain("Learner 10");
    expect(html).toContain("Learner 01");
    expect(html).not.toContain("Learner 11");
    expect(html).not.toContain("Learner 00");
    expect(html.indexOf("Learner 10")).toBeLessThan(html.indexOf("Learner 01"));
  });

  it("with zero certificates shows the empty sentence and the queue still renders", async () => {
    const html = await render();
    expect(html).toContain("No certificates have been issued yet.");
    expect(html).toContain("Nothing awaiting issuance");
    expect(mocks.listCertificateIssuanceSources).not.toHaveBeenCalled();
  });

  it.each([
    ["listPendingIssuance", () => mocks.listPendingIssuance],
    ["certificateService.list", () => mocks.list],
    ["listCertificateIssuanceSources", () => mocks.listCertificateIssuanceSources],
  ])("maps AuthorizationError from %s to notFound()", async (name, pick) => {
    if (name === "listCertificateIssuanceSources") mocks.list.mockResolvedValue([cert()]);
    pick().mockRejectedValue(new AuthorizationError("certificates.view"));
    await expect(Page()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("maps AuthenticationError to notFound()", async () => {
    mocks.list.mockRejectedValue(new AuthenticationError());
    await expect(Page()).rejects.toThrow(NOT_FOUND);
  });

  it("guard: unexpected errors propagate rather than becoming a 404", async () => {
    mocks.list.mockRejectedValue(new Error("db down"));
    await expect(Page()).rejects.toThrow("db down");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
