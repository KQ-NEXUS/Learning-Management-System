/**
 * AuditTable mobile parity (Phase 04.1 gap G-04.1-01 / CR-12, requirement NFR-09).
 *
 * AuditTable is a deliberate sibling of ResourceTable — it keeps an
 * expand-in-place detail the primitive does not model. Below `sm` the desktop
 * table is hidden and a semantic card list takes over, so a mobile audit
 * reader inspects exactly the same event and the same evidence a desktop
 * reader does, with nothing clipped and nothing scrolled sideways (D-04).
 *
 * jsdom applies no CSS, so both the desktop `<table>` and the mobile card
 * `<ul>` are in the DOM at once; every assertion is scoped to one or the
 * other. A true 360px reflow check is a manual gate (see SUMMARY) because
 * jsdom measures no geometry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AuditRow } from "@/server/services/audit-read-service";
import { AuditTable } from "@/app/staff/audit/AuditTable";
import { formatTimestamp } from "@/lib/format-timestamp";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/staff/audit",
  useSearchParams: () => new URLSearchParams(""),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LONG_TARGET_ID = "course-0123456789abcdef-a-deliberately-long-identifier-value";

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "evt-1",
    createdAt: new Date("2026-01-15T10:30:00Z"),
    actorId: "user-1",
    actorName: "Ada Lovelace",
    actorEmail: "ada.lovelace@example.com",
    actorType: "user",
    action: "course.publish",
    targetType: "course",
    targetId: LONG_TARGET_ID,
    scopeType: "programme",
    scopeId: "prog-42",
    before: { status: "draft" },
    after: { status: "published" },
    reason: "Ready for the new cohort intake, confirmed with the programme lead",
    outcome: "success",
    correlationId: null,
    ...overrides,
  };
}

/** The mobile card list — scoped by its accessible name so the diff <ul> in a
 *  revealed detail never collides with it. */
function mobileList(): HTMLElement {
  return screen.getByRole("list", { name: /audit history/i });
}

describe("AuditTable — mobile detail card (task 1)", () => {
  it("renders one semantic card per event with actor, action, target and timestamp", () => {
    const row = makeRow();
    render(<AuditTable rows={[row]} />);

    const cards = within(mobileList()).getAllByRole("listitem");
    expect(cards).toHaveLength(1);

    const card = within(cards[0]);
    expect(card.getByText("Ada Lovelace")).toBeTruthy();
    expect(card.getByText("ada.lovelace@example.com")).toBeTruthy();
    expect(card.getByText("course.publish")).toBeTruthy();
    expect(card.getByText(/course/)).toBeTruthy();
    expect(card.getByText(formatTimestamp(row.createdAt))).toBeTruthy();
  });

  it("keeps the full target identifier in the mobile card rather than clipping it", () => {
    render(<AuditTable rows={[makeRow()]} />);

    // Desktop shortens the id to eight characters; the mobile reader must be
    // able to read the whole value.
    expect(within(mobileList()).getByText(LONG_TARGET_ID)).toBeTruthy();
  });

  it("expands a mobile card in place to reveal the same complete event evidence as desktop", () => {
    render(<AuditTable rows={[makeRow()]} />);

    const list = mobileList();
    const toggle = within(list).getByRole("button", { name: /ada lovelace/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const detail = within(document.getElementById(controls as string) as HTMLElement);
    expect(detail.getByText(/prog-42/)).toBeTruthy();
    expect(detail.getByText(/success/)).toBeTruthy();
    expect(detail.getByText(/Ready for the new cohort intake/)).toBeTruthy();
    // before → after evidence for the changed field.
    expect(detail.getByText(/status:/)).toBeTruthy();
    expect(detail.getByText(/draft/)).toBeTruthy();
    expect(detail.getByText(/published/)).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(controls as string)).toBeNull();
  });

  it("reveals a no-op event with an explicit 'no field-level changes' note", () => {
    render(
      <AuditTable
        rows={[makeRow({ before: { status: "draft" }, after: { status: "draft" } })]}
      />,
    );

    const list = mobileList();
    fireEvent.click(within(list).getByRole("button", { name: /ada lovelace/i }));
    expect(screen.getByText(/no field-level changes recorded/i)).toBeTruthy();
  });
});
