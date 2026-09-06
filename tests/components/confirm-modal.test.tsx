import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentType } from "react";
import type { ConfirmModalProps } from "@/components/primitives";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function loadConfirmModal(): Promise<ComponentType<ConfirmModalProps>> {
  const primitives = await import("@/components/primitives");
  const component = (primitives as Record<string, unknown>).ConfirmModal;

  expect(
    component,
    "the primitives module must export the planned ConfirmModal",
  ).toBeTypeOf("function");

  return component as ComponentType<ConfirmModalProps>;
}

/** Renders a trigger button plus the dialog, so focus-return assertions are real. */
function Harness({
  ConfirmModal,
  props,
}: {
  ConfirmModal: ComponentType<ConfirmModalProps>;
  props: Omit<ConfirmModalProps, "open" | "onCancel"> & { onCancel?: () => void };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <ConfirmModal
        {...props}
        open={open}
        onCancel={() => {
          props.onCancel?.();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe("ConfirmModal", () => {
  it("opening with an empty reason renders confirm disabled and a live counter showing zero against the minimum", async () => {
    const ConfirmModal = await loadConfirmModal();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        minReasonLength={10}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Refund" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    const counter = screen.getByText(/0 \/ 10 minimum/);
    expect(counter.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a reason shorter than minReasonLength keeps confirm disabled and updates the counter; reaching the minimum enables confirm", async () => {
    const ConfirmModal = await loadConfirmModal();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        minReasonLength={10}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: /Reason/i });
    const confirm = screen.getByRole("button", { name: "Refund" });

    fireEvent.change(textarea, { target: { value: "short" } });
    expect(screen.getByText(/5 \/ 10 minimum/)).toBeTruthy();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "long enough reason" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("onConfirm is called with the typed reason string when confirm is activated", async () => {
    const ConfirmModal = await loadConfirmModal();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        minReasonLength={5}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: /Reason/i });
    fireEvent.change(textarea, { target: { value: "Customer requested" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund" }));

    expect(onConfirm).toHaveBeenCalledWith("Customer requested");
  });

  it("traps focus: Tab from the last focusable element inside the dialog returns focus to the first", async () => {
    const ConfirmModal = await loadConfirmModal();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        minReasonLength={5}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length).toBeGreaterThan(1);

    const last = focusable[focusable.length - 1];
    const first = focusable[0];
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("returns focus to the element that was focused before the dialog opened", async () => {
    const ConfirmModal = await loadConfirmModal();
    render(
      <Harness
        ConfirmModal={ConfirmModal}
        props={{
          title: "Refund order",
          description: "This cannot be undone.",
          confirmLabel: "Refund",
          onConfirm: () => {},
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("pending disables confirm, and an ESC keydown while pending does NOT invoke onCancel; while not pending it does", async () => {
    const ConfirmModal = await loadConfirmModal();
    const onCancelPending = vi.fn();

    const { unmount } = render(
      <ConfirmModal
        open
        pending
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        onConfirm={() => {}}
        onCancel={onCancelPending}
      />,
    );

    const confirmPending = screen.getByRole("button", { name: /Working/ });
    expect((confirmPending as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancelPending).not.toHaveBeenCalled();
    unmount();

    const onCancelIdle = vi.fn();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        onConfirm={() => {}}
        onCancel={onCancelIdle}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancelIdle).toHaveBeenCalledTimes(1);
  });

  it("an error prop renders the explicit not-applied wording alongside the specific message", async () => {
    const ConfirmModal = await loadConfirmModal();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        error="The payment gateway rejected the request."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Action not applied/i);
    expect(alert.textContent).toMatch(/The payment gateway rejected the request\./);
  });

  it("the default eyebrow reads 'Integrity action' when none is supplied", async () => {
    const ConfirmModal = await loadConfirmModal();
    render(
      <ConfirmModal
        open
        title="Refund order"
        description="This cannot be undone."
        confirmLabel="Refund"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByText("Integrity action")).toBeTruthy();
  });
});
