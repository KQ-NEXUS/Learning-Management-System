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
    scopeType: "PROGRAMME",
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
    expect(card.getByText(LONG_TARGET_ID)).toBeTruthy();
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
    expect(within(list).getByText(/no field-level changes recorded/i)).toBeTruthy();
  });
});

describe("AuditTable — state parity and narrow text (task 2)", () => {
  const ROWS: AuditRow[] = [
    makeRow({ id: "evt-1", actorName: "Ada Lovelace", action: "course.publish" }),
    makeRow({
      id: "evt-2",
      actorName: "Grace Hopper",
      actorEmail: "grace.hopper@example.com",
      action: "role.assignment.create",
      targetType: "assignment",
      targetId: "assignment-abcdef0123456789-another-long-identifier",
      before: null,
      after: { roleId: "role-7" },
      reason: null,
      outcome: "success",
    }),
    makeRow({
      id: "evt-3",
      actorName: null,
      actorEmail: null,
      action: "session.expire",
      targetType: "session",
      targetId: null,
      before: {},
      after: {},
      reason: "Automatic housekeeping",
      outcome: "success",
    }),
  ];

  it("renders one mobile card for every returned event", () => {
    render(<AuditTable rows={ROWS} />);
    const cards = within(mobileList()).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    expect(within(cards[1]).getByText("Grace Hopper")).toBeTruthy();
    expect(within(cards[2]).getByText("System")).toBeTruthy();
  });

  it("gives every expansion control a unique id across both responsive representations", () => {
    render(<AuditTable rows={ROWS} />);

    const toggles = screen.getAllByRole("button", { name: /grace hopper/i });
    // one desktop, one mobile control for the same event.
    expect(toggles).toHaveLength(2);
    const controlIds = toggles.map((t) => t.getAttribute("aria-controls") as string);
    expect(new Set(controlIds).size).toBe(2);

    // The two representations share one expansion state, so each is exercised
    // on its own; the revealed detail's id must match that control's target.
    for (const toggle of toggles) {
      fireEvent.click(toggle);
      expect(document.getElementById(toggle.getAttribute("aria-controls") as string)).toBeTruthy();
      fireEvent.click(toggle);
      expect(document.getElementById(toggle.getAttribute("aria-controls") as string)).toBeNull();
    }
  });

  it("keeps long actor, action and target values in the rendered mobile content, wrapping not clipping", () => {
    render(<AuditTable rows={ROWS} />);
    const card = within(within(mobileList()).getAllByRole("listitem")[1]);

    const target = card.getByText("assignment-abcdef0123456789-another-long-identifier");
    expect(target.className).toMatch(/overflow-wrap:anywhere/);
    expect(target.closest("[class*='min-w-0']")).toBeTruthy();

    const action = card.getByText("role.assignment.create");
    expect(action.className).toMatch(/overflow-wrap:anywhere/);
    expect(action.className).toMatch(/min-w-0/);
  });

  it("preserves the filter controls alongside the mobile cards", () => {
    render(
      <AuditTable
        rows={ROWS}
        filters={{ actorId: "", action: "", from: "", to: "" }}
        filterOptions={{
          actions: ["course.publish", "role.assignment.create"],
          actors: [{ id: "user-1", name: "Ada Lovelace", email: "ada.lovelace@example.com" }],
        }}
      />,
    );

    expect(screen.getByRole("combobox", { name: /actor/i })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /action/i })).toBeTruthy();
    expect(within(mobileList()).getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows the empty state with no table and no card list", () => {
    render(<AuditTable rows={[]} />);
    expect(screen.getByText(/no audit events yet/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: /audit history/i })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the error branch without exposing a card list", () => {
    render(<AuditTable error={{ message: "The request failed." }} rows={ROWS} />);
    expect(screen.getByText(/could not load audit events/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: /audit history/i })).toBeNull();
  });

  it("denied: renders byte-identical output regardless of whether events exist, leaking no count", () => {
    const { container: a, unmount } = render(
      <AuditTable denied={{ permission: "audit.view" }} rows={ROWS} />,
    );
    const withRows = a.innerHTML;
    unmount();

    const { container: b } = render(<AuditTable denied={{ permission: "audit.view" }} />);
    expect(b.innerHTML).toBe(withRows);
    expect(withRows).not.toContain("Grace Hopper");
    expect(withRows).not.toContain("evt-2");
  });

  // jsdom measures no geometry, so a genuine 360px reflow — no horizontal
  // scrollbar, every value legible — is a manual gate recorded in the SUMMARY.
  it.skip("[manual gate] audit history reflows with no sideways scroll at 360px", () => {});
});
