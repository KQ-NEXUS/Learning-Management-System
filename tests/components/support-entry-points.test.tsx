/**
 * Plan 12-06: contextual "Get help with this" entry points. The link is only a
 * hint (kind + opaque id); these tests pin what each surface renders and that
 * the href never carries business values (T-12-12).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { GetSupportLink } from "@/components/support/GetSupportLink";
import { CertificateSlot } from "@/components/learner/CertificateSlot";
import { ResultsList } from "@/components/learner/ResultsList";

afterEach(cleanup);

const helpLinks = () => screen.queryAllByRole("link", { name: "Get help with this" });

describe("GetSupportLink", () => {
  it("targets /support/new with only closed kind and opaque id", () => {
    render(<GetSupportLink kind="ORDER" id="ord_123" />);
    const href = helpLinks()[0].getAttribute("href")!;
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/support/new");
    expect([...url.searchParams.keys()].sort()).toEqual(["contextId", "contextKind"]);
    expect(url.searchParams.get("contextKind")).toBe("ORDER");
    expect(url.searchParams.get("contextId")).toBe("ord_123");
  });

  it("renders nothing without a server-known id", () => {
    render(<GetSupportLink kind="COHORT" id={null} />);
    expect(helpLinks()).toHaveLength(0);
  });

  it("encodes hostile ids instead of injecting extra params", () => {
    render(<GetSupportLink kind="COURSE" id="x&contextKind=USER" />);
    const url = new URL(helpLinks()[0].getAttribute("href")!, "http://x");
    expect(url.searchParams.getAll("contextKind")).toEqual(["COURSE"]);
    expect(url.searchParams.get("contextId")).toBe("x&contextKind=USER");
  });
});

describe("certificate surface", () => {
  const issued = { certificateId: "cert-1", verificationRef: "REF-1", issuedAt: new Date("2026-01-01") };
  it.each(["issued", "flagged"] as const)("links %s certificates by id only", (kind) => {
    render(<CertificateSlot certificate={{ kind, ...issued }} />);
    const href = helpLinks()[0].getAttribute("href")!;
    expect(href).toContain("contextKind=CERTIFICATE");
    expect(href).toContain("contextId=cert-1");
    expect(href).not.toContain("REF-1");
  });

  it.each([{ kind: "revoked" }, { kind: "pending-issuance" }, { kind: "not-complete" }, { kind: "not-applicable" }] as const)(
    "offers no link without a concrete certificate (%o)",
    (certificate) => {
      render(<CertificateSlot certificate={certificate} />);
      expect(helpLinks()).toHaveLength(0);
    },
  );
});

describe("submission/result surface", () => {
  const base = {
    type: "ASSIGNMENT" as const, courseId: "course-1", effectiveScore: 8, maxScore: 10, passed: true, passMark: 5,
    feedback: null, attemptsRemaining: null, overrides: [],
  };
  it("links the latest concrete submission, not quiz attempts or receipt ids", () => {
    render(
      <ResultsList
        results={[
          { ...base, assessmentId: "a1", title: "Essay", history: [{ kind: "submission", ref: "RCPT-9", submissionId: "sub-1", number: 1, at: new Date(), status: "READY", score: null }] },
          { ...base, assessmentId: "q1", title: "Quiz", type: "QUIZ", history: [{ kind: "attempt", ref: "att-1", number: 1, at: new Date(), status: "SUBMITTED", score: 8 }] },
        ]}
      />,
    );
    const links = helpLinks();
    expect(links).toHaveLength(1);
    const href = links[0].getAttribute("href")!;
    expect(href).toContain("contextKind=SUBMISSION");
    expect(href).toContain("contextId=sub-1");
    expect(href).not.toContain("RCPT-9");
    expect(href).not.toContain("Essay");
  });
});
