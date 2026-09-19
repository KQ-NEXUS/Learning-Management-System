/**
 * `CertificateSlot` (plan 11-13 Task 3, UI-SPEC §7.6/§6.1) — the five
 * branches rendered with the exact copy strings, in the jsdom "components"
 * Vitest project (`vitest.config.mts`), the same home
 * `tests/components/staff-progress-override.test.tsx` documents for a
 * dashboard-facing component with no client hooks. No `@testing-library/jest-dom`
 * matchers are configured in this project (`tests/components/setup.ts`), so
 * assertions use plain `toBeTruthy()`/DOM property reads, matching
 * `tests/components/cohort-roster.test.tsx`'s own convention.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CertificateSlot } from "@/components/learner/CertificateSlot";
import {
  deriveCertificateColumn,
  type CertificateColumn,
} from "@/server/services/enrolment-dashboard-service";

afterEach(() => {
  cleanup();
});

const issued: CertificateColumn = {
  kind: "issued",
  certificateId: "cert-1",
  verificationRef: "VERIF-REF-ABC123",
  issuedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const flagged: CertificateColumn = {
  kind: "flagged",
  certificateId: "cert-1",
  verificationRef: "VERIF-REF-ABC123",
  issuedAt: new Date("2026-09-01T00:00:00.000Z"),
};

describe("CertificateSlot", () => {
  it("not-complete — keeps Phase 9's exact 'arriving in a future update' copy", () => {
    render(<CertificateSlot certificate={{ kind: "not-complete" }} />);
    expect(screen.getByText("Certificate — arriving in a future update")).toBeTruthy();
  });

  it("pending-issuance — renders the exact 'being finalized' copy with no action", () => {
    render(<CertificateSlot certificate={{ kind: "pending-issuance" }} />);
    expect(screen.getByText("Your certificate is being finalized by your instructor.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /download certificate/i })).toBeNull();
  });

  it("issued — renders the download link and the verification reference", () => {
    render(<CertificateSlot certificate={issued} />);
    const link = screen.getByRole("link", { name: /download certificate/i });
    expect(link.getAttribute("href")).toBe("/api/certificates/cert-1/download");
    expect(screen.getByText("VERIF-REF-ABC123")).toBeTruthy();
  });

  it("flagged — renders the exact reassuring copy AND still renders the download link", () => {
    render(<CertificateSlot certificate={flagged} />);
    expect(
      screen.getByText(
        "Your certificate is under review following a recent correction. This won't affect your completed work.",
      ),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /download certificate/i });
    expect(link.getAttribute("href")).toBe("/api/certificates/cert-1/download");
  });

  it("flagged after a superseded completion (UAT test 17) — shows the download link and reference, not the deferred copy", () => {
    // The column deriveCertificateColumn now produces for: no unsuperseded
    // completion record + an ACTIVE flagged certificate.
    const supersededFlagged = deriveCertificateColumn({
      hasCompletionRecord: false,
      certificate: {
        enrolmentId: "enrolment-1",
        scope: "PROGRAMME",
        id: "cert-programme",
        status: "ACTIVE",
        reviewFlaggedAt: new Date("2026-09-10T00:00:00.000Z"),
        verificationRef: "VERIF-REF-PROG",
        issuedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    expect(supersededFlagged.kind).toBe("flagged");

    render(<CertificateSlot certificate={supersededFlagged} />);
    const link = screen.getByRole("link", { name: /download certificate/i });
    expect(link.getAttribute("href")).toBe("/api/certificates/cert-programme/download");
    expect(screen.getByText("VERIF-REF-PROG")).toBeTruthy();
    expect(screen.queryByText(/arriving in a future update/i)).toBeNull();
  });

  it("revoked — renders the exact revoked copy, no download link, no reference", () => {
    render(<CertificateSlot certificate={{ kind: "revoked" }} />);
    expect(
      screen.getByText(
        "Your certificate for this course/programme has been revoked. Contact support for details.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /download certificate/i })).toBeNull();
    expect(screen.queryByText(issued.verificationRef)).toBeNull();
  });

  it("renders the verification reference in mono with break-all, never truncate", () => {
    render(<CertificateSlot certificate={issued} />);
    const ref = screen.getByText("VERIF-REF-ABC123");
    expect(ref.className).toContain("break-all");
    expect(ref.className).toContain("font-mono");
    expect(ref.className).not.toContain("truncate");
  });
});
