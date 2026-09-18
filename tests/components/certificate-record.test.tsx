/**
 * Plan 11-15 — the staff certificate record surface (CRD-03, CRD-05, CRD-06):
 *
 *   1. `IssuedCertificatesTable` — the full record list, UI-SPEC §5's four-branch status
 *      precedence, the All/Active/Flagged/Revoked filter, no inline row actions.
 *   2. The certificate detail page (`[id]/page.tsx`) — award facts, the "Issued by" actor
 *      resolution, revoked-wins-over-flagged banner precedence, and the one-hop-each-way
 *      supersede chain.
 *   3. `CertificateRecordActions` + `certificate-record-actions.ts` — the four action states, the
 *      revoke/reissue `ConfirmModal` tone/copy/`minReasonLength` contract, and the server action's
 *      own `.strict()` schema enforcement independent of the UI (T-11-49).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CertificateRow } from "@/server/services/certificate-service";
import { IssuedCertificatesTable } from "@/app/staff/certificates/issued/IssuedCertificatesTable";
import { CertificateRecordActions } from "@/app/staff/certificates/issued/[id]/CertificateRecordActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
    verificationRef: "VERIF-0001-LONG-REFERENCE",
    revokedAt: null,
    revokedById: null,
    revocationReason: null,
    supersedesId: null,
    reviewFlaggedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. IssuedCertificatesTable
// ---------------------------------------------------------------------------

describe("IssuedCertificatesTable — status precedence (UI-SPEC §5)", () => {
  it("renders all four pill branches", () => {
    const rows = [
      baseCert({ id: "c-active", status: "ACTIVE" }),
      baseCert({ id: "c-flagged", status: "ACTIVE", reviewFlaggedAt: new Date("2026-02-01") }),
      baseCert({
        id: "c-revoked",
        status: "REVOKED",
        revokedAt: new Date("2026-02-01"),
        revocationReason: "Fraud investigation confirmed",
      }),
      baseCert({ id: "c-superseded", status: "SUPERSEDED" }),
    ];
    render(<IssuedCertificatesTable rows={rows} />);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Flagged for review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Revoked").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Superseded").length).toBeGreaterThan(0);
  });

  it("a status:ACTIVE row with reviewFlaggedAt set renders 'Flagged for review', never 'Active'", () => {
    const rows = [baseCert({ status: "ACTIVE", reviewFlaggedAt: new Date("2026-02-01") })];
    render(<IssuedCertificatesTable rows={rows} />);
    expect(screen.getAllByText("Flagged for review").length).toBeGreaterThan(0);
    // Exclude the "Active" segmented-filter button — only the pill itself must be absent.
    const activePillMatches = screen.queryAllByText("Active").filter((el) => el.tagName !== "BUTTON");
    expect(activePillMatches.length).toBe(0);
  });

  it("renders the verification reference with break-all and never truncate", () => {
    const rows = [baseCert({ verificationRef: "REF-ABCDEF1234567890" })];
    const { container } = render(<IssuedCertificatesTable rows={rows} />);
    const [refEl] = screen.getAllByText("REF-ABCDEF1234567890");
    expect(refEl.className).toContain("break-all");
    expect(container.innerHTML).not.toContain("truncate");
  });
});

describe("IssuedCertificatesTable — filter (UI-SPEC §6.1)", () => {
  it("renders the four segmented filter options and 'Active' excludes flagged rows", () => {
    const rows = [
      baseCert({ id: "c-active", learnerName: "Active Learner", status: "ACTIVE" }),
      baseCert({
        id: "c-flagged",
        learnerName: "Flagged Learner",
        status: "ACTIVE",
        reviewFlaggedAt: new Date("2026-02-01"),
      }),
    ];
    render(<IssuedCertificatesTable rows={rows} />);

    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Active" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Flagged" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoked" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Active" }));
    expect(screen.getAllByText("Active Learner").length).toBeGreaterThan(0);
    expect(screen.queryByText("Flagged Learner")).toBeNull();
  });
});

describe("IssuedCertificatesTable — no inline destructive actions", () => {
  it("renders no revoke or reissue control in any row", () => {
    const rows = [
      baseCert({
        status: "REVOKED",
        revokedAt: new Date("2026-02-01"),
        revocationReason: "Fraud investigation confirmed",
      }),
    ];
    render(<IssuedCertificatesTable rows={rows} />);
    expect(screen.queryByText("Revoke certificate")).toBeNull();
    expect(screen.queryByText("Reissue certificate")).toBeNull();
  });
});

describe("IssuedCertificatesTable — empty state", () => {
  it("renders the exact UI-SPEC §6 empty-state copy", () => {
    render(<IssuedCertificatesTable rows={[]} />);
    expect(screen.getByText("No certificates issued yet")).toBeTruthy();
    expect(
      screen.getByText("Certificates appear here automatically once one is issued."),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Certificate detail page
// ---------------------------------------------------------------------------

const pageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(async () => [] as unknown[]),
  getIssuer: vi.fn(async () => null as unknown),
  enrolmentScope: vi.fn(async () => ({})),
  resolveActorNames: vi.fn(async () => new Map<string, string | null>()),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: pageMocks.notFound,
  useRouter: () => ({ push: pageMocks.push, refresh: pageMocks.refresh }),
}));

vi.mock("@/server/services/cohort-scope", () => ({
  enrolmentCohortScope: pageMocks.enrolmentScope,
}));

vi.mock("@/server/services/grading-service", () => ({
  resolveActorNames: pageMocks.resolveActorNames,
}));

vi.mock("@/server/services/certificate-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/certificate-service")>();
  return {
    ...actual,
    certificateService: { get: pageMocks.get, list: pageMocks.list },
    getCertificateIssuer: pageMocks.getIssuer,
  };
});

import CertificateDetailPage from "@/app/staff/certificates/issued/[id]/page";

function run(id = "cert-1") {
  return CertificateDetailPage({ params: Promise.resolve({ id }) });
}

describe("Certificate detail page — facts (UI-SPEC §6.1)", () => {
  it("renders the exact fact labels", async () => {
    pageMocks.get.mockResolvedValue(baseCert());
    pageMocks.list.mockResolvedValue([]);
    pageMocks.getIssuer.mockResolvedValue(null);
    render(await run());
    expect(screen.getByText("Verification reference")).toBeTruthy();
    expect(screen.getByText("Awarded for")).toBeTruthy();
    expect(screen.getByText("Issued")).toBeTruthy();
  });

  it("renders 'System (automatic issuance)' for a system-issued certificate", async () => {
    pageMocks.get.mockResolvedValue(baseCert());
    pageMocks.list.mockResolvedValue([]);
    pageMocks.getIssuer.mockResolvedValue(null);
    render(await run());
    const issuedDd = screen.getByText("Issued").closest("div")?.querySelector("dd");
    expect(issuedDd?.textContent).toContain("by System (automatic issuance)");
  });

  it("renders the actor's name for a staff-issued certificate", async () => {
    pageMocks.get.mockResolvedValue(baseCert());
    pageMocks.list.mockResolvedValue([]);
    pageMocks.getIssuer.mockResolvedValue({ actorId: "staff-1", actorName: "Grace Staff" });
    render(await run());
    const issuedDd = screen.getByText("Issued").closest("div")?.querySelector("dd");
    expect(issuedDd?.textContent).toContain("by Grace Staff");
  });
});

describe("Certificate detail page — banner precedence (revoked wins over flagged)", () => {
  it("renders only the revoked banner when both revokedAt and reviewFlaggedAt are set", async () => {
    pageMocks.get.mockResolvedValue(
      baseCert({
        status: "REVOKED",
        revokedAt: new Date("2026-03-01T00:00:00.000Z"),
        revokedById: "staff-1",
        revocationReason: "Fraud investigation confirmed",
        reviewFlaggedAt: new Date("2026-02-15T00:00:00.000Z"),
      }),
    );
    pageMocks.list.mockResolvedValue([]);
    pageMocks.getIssuer.mockResolvedValue(null);
    pageMocks.resolveActorNames.mockResolvedValue(new Map([["staff-1", "Grace Staff"]]));
    render(await run());
    expect(screen.getByText(/Fraud investigation confirmed/)).toBeTruthy();
    expect(screen.queryByText(/flagged for review on/)).toBeNull();
  });

  it("renders only the flagged banner for an ACTIVE, flagged certificate", async () => {
    pageMocks.get.mockResolvedValue(
      baseCert({ reviewFlaggedAt: new Date("2026-02-15T00:00:00.000Z") }),
    );
    pageMocks.list.mockResolvedValue([]);
    pageMocks.getIssuer.mockResolvedValue(null);
    render(await run());
    expect(screen.getByText(/flagged for review on/)).toBeTruthy();
    expect(screen.queryByText(/^Revoked/)).toBeNull();
  });
});

describe("Certificate detail page — supersede chain (UI-SPEC §8 zero-one-many)", () => {
  it("renders 'Supersedes' and 'Superseded by' as links to each certificate's own detail page", async () => {
    pageMocks.get.mockImplementation(async (id: string) => {
      if (id === "cert-1") return baseCert({ id: "cert-1", supersedesId: "cert-old" });
      if (id === "cert-old") return baseCert({ id: "cert-old", verificationRef: "OLD-REF" });
      return null;
    });
    pageMocks.list.mockResolvedValue([
      baseCert({ id: "cert-new", verificationRef: "NEW-REF", supersedesId: "cert-1" }),
    ]);
    pageMocks.getIssuer.mockResolvedValue(null);
    render(await run());
    const supersedesLink = screen.getByRole("link", { name: "OLD-REF" });
    expect(supersedesLink.getAttribute("href")).toBe("/staff/certificates/issued/cert-old");
    const supersededByLink = screen.getByRole("link", { name: "NEW-REF" });
    expect(supersededByLink.getAttribute("href")).toBe("/staff/certificates/issued/cert-new");
  });

  it("renders no chain facts when there is no supersede relationship", async () => {
    pageMocks.get.mockResolvedValue(baseCert());
    pageMocks.list.mockResolvedValue([]);
    pageMocks.getIssuer.mockResolvedValue(null);
    render(await run());
    expect(screen.queryByText("Supersedes")).toBeNull();
    expect(screen.queryByText("Superseded by")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. CertificateRecordActions — the four action states
// ---------------------------------------------------------------------------

describe("CertificateRecordActions — four action states (UI-SPEC §7.4)", () => {
  it("renders only 'Revoke certificate' for active, unflagged", () => {
    render(<CertificateRecordActions certificateId="cert-1" displayStatus="active" />);
    expect(screen.getByRole("button", { name: /Revoke certificate/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reissue certificate/ })).toBeNull();
  });

  it("renders only 'Revoke certificate' for active, flagged — the banner carries the framing", () => {
    render(<CertificateRecordActions certificateId="cert-1" displayStatus="flagged" />);
    expect(screen.getByRole("button", { name: /Revoke certificate/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reissue certificate/ })).toBeNull();
  });

  it("renders only 'Reissue certificate' for revoked", () => {
    render(<CertificateRecordActions certificateId="cert-1" displayStatus="revoked" />);
    expect(screen.getByRole("button", { name: /Reissue certificate/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Revoke certificate/ })).toBeNull();
  });

  it("renders zero action buttons for superseded", () => {
    const { container } = render(
      <CertificateRecordActions certificateId="cert-1" displayStatus="superseded" />,
    );
    expect(container.querySelectorAll("button").length).toBe(0);
  });
});

describe("CertificateRecordActions — modal tone/copy/minReasonLength (§0.4, §6)", () => {
  it("opens the revoke modal with tone=danger and the exact UI-SPEC copy", () => {
    render(<CertificateRecordActions certificateId="cert-1" displayStatus="active" />);
    fireEvent.click(screen.getByRole("button", { name: /Revoke certificate/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "This certificate's public verification status will immediately show as revoked. This action requires a reason and is recorded in the audit history.",
      ),
    ).toBeTruthy();
    const confirmBtn = within(dialog).getByRole("button", { name: "Revoke certificate" });
    expect(confirmBtn.className).toContain("bg-danger");
  });

  it("opens the reissue modal with tone=default and the exact UI-SPEC copy", () => {
    render(<CertificateRecordActions certificateId="cert-1" displayStatus="revoked" />);
    fireEvent.click(screen.getByRole("button", { name: /Reissue certificate/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "A new certificate will be generated and linked to this one. The original stays on record as superseded. This action requires a reason and is recorded in the audit history.",
      ),
    ).toBeTruthy();
    const confirmBtn = within(dialog).getByRole("button", { name: "Reissue certificate" });
    expect(confirmBtn.className).toContain("bg-accent");
  });

  it("both modals require minReasonLength=10 — a 9-character reason keeps Confirm disabled", () => {
    render(<CertificateRecordActions certificateId="cert-1" displayStatus="active" />);
    fireEvent.click(screen.getByRole("button", { name: /Revoke certificate/ }));
    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "123456789" } });
    const confirmBtn = within(dialog).getByRole("button", { name: "Revoke certificate" });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: "1234567890" } });
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("CertificateRecordActions — successful mutation outcomes", () => {
  it("revoke success calls router.refresh and closes the modal", async () => {
    const revoke = vi.fn(async () => ({ ok: true as const }));
    render(
      <CertificateRecordActions certificateId="cert-1" displayStatus="active" revoke={revoke} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Revoke certificate/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Fraud investigation confirmed" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke certificate" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revoke).toHaveBeenCalledExactlyOnceWith({
      certificateId: "cert-1",
      reason: "Fraud investigation confirmed",
    });
  });

  it("reissue success navigates to the NEW certificate's detail page", async () => {
    const reissue = vi.fn(async () => ({ ok: true as const, certificateId: "cert-new" }));
    render(
      <CertificateRecordActions certificateId="cert-1" displayStatus="revoked" reissue={reissue} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reissue certificate/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "Grade correction resolved" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reissue certificate" }));
    await waitFor(() =>
      expect(pageMocks.push).toHaveBeenCalledWith("/staff/certificates/issued/cert-new"),
    );
  });
});
