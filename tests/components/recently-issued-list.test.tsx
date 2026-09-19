/**
 * Plan 11-23 Task 1 — the "Recently issued" section on the Certificates landing page
 * (UAT test 8, landing-page half). Presentational only: rows and the issuance-source map are
 * passed in, so nothing here touches the service.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CertificateRow, IssuanceSource } from "@/server/services/certificate-service";
import { RecentlyIssuedList } from "@/app/staff/certificates/RecentlyIssuedList";

afterEach(() => cleanup());

function baseCert(overrides: Partial<CertificateRow> = {}): CertificateRow {
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
    ...overrides,
  };
}

describe("RecentlyIssuedList", () => {
  it("renders learner, award, timestamp, issued-by label and a detail link per row", () => {
    const rows = [
      baseCert({ id: "c-auto", learnerName: "Ada Lovelace", awardTitle: "Intro to Testing" }),
      baseCert({ id: "c-staff", learnerName: "Grace Hopper", awardTitle: "Compilers" }),
      baseCert({ id: "c-staff-anon", learnerName: "Alan Turing", awardTitle: "Computability" }),
      baseCert({ id: "c-none", learnerName: "Edsger Dijkstra", awardTitle: "Algorithms" }),
    ];
    const sources: Record<string, IssuanceSource> = {
      "c-auto": { kind: "automatic" },
      "c-staff": { kind: "staff", actorName: "Sam Registrar" },
      "c-staff-anon": { kind: "staff", actorName: null },
      "c-none": { kind: "not-recorded" },
    };
    render(<RecentlyIssuedList rows={rows} sources={sources} />);

    expect(screen.getByRole("heading", { name: "Recently issued" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);

    const auto = items[0];
    expect(within(auto).getByText("Ada Lovelace")).toBeTruthy();
    expect(within(auto).getByText("Intro to Testing")).toBeTruthy();
    expect(within(auto).getByText("01/01/2026, 00:00:00")).toBeTruthy();
    expect(within(auto).getByText("Automatic")).toBeTruthy();
    expect(within(auto).getByRole("link").getAttribute("href")).toBe("/staff/certificates/issued/c-auto");

    expect(within(items[1]).getByText("Sam Registrar")).toBeTruthy();
    expect(within(items[2]).getByText("Staff member")).toBeTruthy();
    expect(within(items[3]).getByText("Not recorded")).toBeTruthy();
    expect(within(items[1]).getByRole("link").getAttribute("href")).toBe("/staff/certificates/issued/c-staff");
  });

  it("shows an Automatic indicator only on automatic rows", () => {
    const rows = [baseCert({ id: "c-auto" }), baseCert({ id: "c-staff", learnerName: "Grace Hopper" })];
    render(
      <RecentlyIssuedList
        rows={rows}
        sources={{
          "c-auto": { kind: "automatic" },
          "c-staff": { kind: "staff", actorName: "Sam Registrar" },
        }}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).queryByText("Automatic")).not.toBeNull();
    expect(within(items[1]).queryByText("Automatic")).toBeNull();
  });

  it("flagged and revoked certificates show their status pill, never a plain Active", () => {
    const rows = [
      baseCert({ id: "c-flag", status: "ACTIVE", reviewFlaggedAt: new Date("2026-02-01") }),
      baseCert({ id: "c-rev", status: "REVOKED", revokedAt: new Date("2026-02-01") }),
      baseCert({ id: "c-ok" }),
    ];
    render(<RecentlyIssuedList rows={rows} sources={{}} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).queryByText("Flagged for review")).not.toBeNull();
    expect(within(items[0]).queryByText("Active")).toBeNull();
    expect(within(items[1]).queryByText("Revoked")).not.toBeNull();
    expect(within(items[2]).queryByText("Active")).not.toBeNull();
  });

  it("with zero rows renders the heading, the empty sentence and no list", () => {
    render(<RecentlyIssuedList rows={[]} sources={{}} />);
    expect(screen.getByRole("heading", { name: "Recently issued" })).toBeTruthy();
    expect(screen.getByText("No certificates have been issued yet.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("wraps very long names and titles in full, without truncation classes", () => {
    const longName = "N".repeat(81);
    const longAward = "A".repeat(81);
    render(
      <RecentlyIssuedList
        rows={[baseCert({ learnerName: longName, awardTitle: longAward })]}
        sources={{}}
      />,
    );
    const name = screen.getByText(longName);
    const award = screen.getByText(longAward);
    for (const el of [name, award]) {
      expect(el.className).toContain("break-words");
      expect(el.className).not.toMatch(/truncate|whitespace-nowrap|text-ellipsis/);
    }
  });

  it("links to the full list", () => {
    render(<RecentlyIssuedList rows={[baseCert()]} sources={{}} />);
    const link = screen.getByRole("link", { name: "View all certificates" });
    expect(link.getAttribute("href")).toBe("/staff/certificates/issued");
  });

  it("guard: source has no raw hex colours and never renders a revocation reason", () => {
    const source = readFileSync(
      resolve(__dirname, "../../src/app/staff/certificates/RecentlyIssuedList.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(source).not.toContain("revocationReason");
  });
});
