/**
 * PublishDialog keyboard + immutable-pending contract (CR-07, WR-01, D-26).
 *
 * The publish confirmation is the one place cohort migration is decided, so
 * two things must hold under source inspection, not just class rendering:
 *
 *   1. It is fully keyboard operable — focus moves in on open, Tab wraps
 *      inside it, Escape cancels while idle but is suppressed in flight, and
 *      focus returns to the opener on close.
 *   2. Once a publish is in flight every migration checkbox and the reason
 *      field are frozen, and the payload handed to `onPublish` is exactly the
 *      immutable `{ migrateCohortIds, reason, expectedUpdatedAt }` the user
 *      confirmed — no bulk toggle, no post-submit mutation.
 *
 * The reported failure path (a mid-flight toggle changing the submitted set,
 * and Escape aborting an in-flight publish) is asserted alongside the happy
 * path.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { ReadinessItem } from "@/server/services/readiness-service";
import { PublishDialog, type AffectedCohort, type PublishDialogProps } from "@/components/catalogue/PublishDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const item = (over: Partial<ReadinessItem> & Pick<ReadinessItem, "id">): ReadinessItem => ({
  category: "Catalogue",
  label: "An item",
  state: "PASS",
  blocking: true,
  ...over,
});

const readyItems = (): ReadinessItem[] => [
  item({ id: "content", category: "Content", label: "Content present", state: "PASS" }),
  item({ id: "price", category: "Price", label: "Price set", state: "PASS" }),
];

const blockedItems = (): ReadinessItem[] => [
  item({ id: "content", category: "Content", label: "Content present", state: "FAIL" }),
];

const cohorts = (): AffectedCohort[] => [
  { id: "co-1", code: "ALPHA-01", title: "Alpha cohort", endsAt: "2026-12-01T00:00:00.000Z", enrolmentCount: 4 },
  { id: "co-2", code: "BETA-02", title: "Beta cohort", endsAt: "2027-01-15T00:00:00.000Z", enrolmentCount: 9 },
];

const TOKEN = "2026-05-01T12:00:00.000Z";

function baseProps(over: Partial<PublishDialogProps> = {}): PublishDialogProps {
  return {
    open: true,
    readinessItems: readyItems(),
    unpublishedChanges: ["Summary changed"],
    affectedCohorts: cohorts(),
    expectedUpdatedAt: TOKEN,
    pending: false,
    error: null,
    onCancel: vi.fn(),
    onPublish: vi.fn(),
    ...over,
  };
}

/** Trigger + dialog, so focus-return assertions exercise a real opener. */
function Harness({ dialogProps }: { dialogProps?: Partial<PublishDialogProps> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open publish
      </button>
      <PublishDialog
        {...baseProps(dialogProps)}
        open={open}
        onCancel={() => {
          dialogProps?.onCancel?.();
          setOpen(false);
        }}
      />
    </div>
  );
}

function focusableIn(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    ),
  );
}

describe("PublishDialog — keyboard lifecycle", () => {
  it("moves focus into the dialog when it opens", () => {
    render(<PublishDialog {...baseProps()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("wraps Tab from the last focusable element back to the first, and Shift+Tab from the first to the last", () => {
    render(<PublishDialog {...baseProps()} />);
    const dialog = screen.getByRole("dialog");
    const focusable = focusableIn(dialog);
    expect(focusable.length).toBeGreaterThan(1);

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Escape cancels while idle but is suppressed while a publish is in flight", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<PublishDialog {...baseProps({ onCancel, pending: true })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();

    rerender(<PublishDialog {...baseProps({ onCancel, pending: false })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("holds focus on the dialog container when every control is disabled during the pending window", () => {
    render(<PublishDialog {...baseProps({ pending: true })} />);
    const dialog = screen.getByRole("dialog");

    // Precondition: with every checkbox, the reason textarea, Publish and Cancel
    // disabled, the dialog exposes no focusable control of its own.
    expect(focusableIn(dialog)).toHaveLength(0);

    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);

    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);
  });

  it("returns focus to the element that opened it when the dialog closes", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open publish" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("PublishDialog — immutable pending payload", () => {
  it("submits exactly the confirmed migrateCohortIds / reason / token", () => {
    const onPublish = vi.fn();
    render(<PublishDialog {...baseProps({ onPublish })} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /ALPHA-01/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/i }), {
      target: { value: "Moving alpha onto the corrected schedule" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledWith({
      migrateCohortIds: ["co-1"],
      reason: "Moving alpha onto the corrected schedule",
      expectedUpdatedAt: TOKEN,
    });
  });

  it("sends reason: null when no cohort is migrated", () => {
    const onPublish = vi.fn();
    render(<PublishDialog {...baseProps({ onPublish })} />);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onPublish).toHaveBeenCalledWith({
      migrateCohortIds: [],
      reason: null,
      expectedUpdatedAt: TOKEN,
    });
  });

  it("freezes every migration checkbox and the reason field while pending, and a mid-flight toggle cannot change the set", () => {
    const onPublish = vi.fn();
    const { rerender } = render(<PublishDialog {...baseProps({ onPublish })} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /ALPHA-01/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/i }), {
      target: { value: "Confirmed migration reason text" },
    });

    rerender(<PublishDialog {...baseProps({ onPublish, pending: true })} />);

    const alpha = screen.getByRole("checkbox", { name: /ALPHA-01/ }) as HTMLInputElement;
    const beta = screen.getByRole("checkbox", { name: /BETA-02/ }) as HTMLInputElement;
    const reason = screen.getByRole("textbox", { name: /Reason/i }) as HTMLTextAreaElement;

    expect(alpha.disabled).toBe(true);
    expect(beta.disabled).toBe(true);
    expect(reason.disabled).toBe(true);

    // A stray click on the disabled control must not mutate selection state.
    fireEvent.click(beta);
    expect(beta.checked).toBe(false);
    expect(alpha.checked).toBe(true);
  });

  it("offers no bulk 'select all cohorts' control", () => {
    render(<PublishDialog {...baseProps()} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: /select all/i })).toBeNull();
  });

  it("keeps Publish disabled — and never calls onPublish — while a blocking readiness item fails", () => {
    const onPublish = vi.fn();
    render(<PublishDialog {...baseProps({ onPublish, readinessItems: blockedItems() })} />);
    const publish = screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    fireEvent.click(publish);
    expect(onPublish).not.toHaveBeenCalled();
  });

  it("requires a reason of at least 10 characters once a cohort is ticked", () => {
    const onPublish = vi.fn();
    render(<PublishDialog {...baseProps({ onPublish })} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /ALPHA-01/ }));
    const publish = screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: /Reason/i }), { target: { value: "short" } });
    expect(publish.disabled).toBe(true);

    fireEvent.change(screen.getByRole("textbox", { name: /Reason/i }), {
      target: { value: "A sufficiently long reason" },
    });
    expect(publish.disabled).toBe(false);
    fireEvent.click(publish);
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
