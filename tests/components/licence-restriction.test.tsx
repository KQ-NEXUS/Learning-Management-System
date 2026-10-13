import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ConfirmModal, ResourceForm } from "@/components/primitives";
import {
  LicenceRestrictionProvider,
  type LicenceRestrictionValue,
} from "@/components/licence/LicenceRestrictionProvider";
import { LicenceRefusalNote, RestrictedControlReason } from "@/components/licence/LicenceRefusalNote";
import {
  LICENCE_REFUSAL_MESSAGE,
  RESTRICTED_CONTROL_REASON_ADMIN,
  RESTRICTED_CONTROL_REASON_STAFF,
} from "@/server/licence/policy";

afterEach(cleanup);

const RESTRICTED_STAFF: LicenceRestrictionValue = { restricted: true, canViewLicence: false, stateLabel: null };
const RESTRICTED_ADMIN: LicenceRestrictionValue = {
  restricted: true,
  canViewLicence: true,
  stateLabel: "Restricted continuity mode",
};
const NOT_RESTRICTED: LicenceRestrictionValue = { restricted: false, canViewLicence: true, stateLabel: null };

function within(value: LicenceRestrictionValue, node: ReactNode) {
  return <LicenceRestrictionProvider value={value}>{node}</LicenceRestrictionProvider>;
}

function modal(props: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  return (
    <ConfirmModal
      open
      title="Cancel this cohort?"
      description="Learners are notified."
      confirmLabel="Cancel cohort"
      tone="default"
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />
  );
}

function form(props: Partial<Parameters<typeof ResourceForm>[0]> = {}) {
  return (
    <ResourceForm title="Edit course" onSubmit={() => {}} onCancel={() => {}} {...props}>
      <input aria-label="Title" name="title" />
    </ResourceForm>
  );
}

/** Every button the restriction disabled must be described by a visible, non-empty element. */
function expectEveryDisabledButtonHasReason(container: HTMLElement) {
  const disabled = Array.from(container.querySelectorAll<HTMLButtonElement>("button:disabled"));
  expect(disabled.length).toBeGreaterThan(0);
  for (const button of disabled) {
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy, `disabled button "${button.textContent}" has no aria-describedby`).toBeTruthy();
    const reason = document.getElementById(describedBy!);
    expect(reason, `aria-describedby ${describedBy} does not resolve`).not.toBeNull();
    expect(reason!.textContent!.trim().length).toBeGreaterThan(0);
    expect(reason!.hasAttribute("hidden")).toBe(false);
    expect(reason!.className).not.toMatch(/\bhidden\b|sr-only/);
  }
}

describe("ConfirmModal licence mirror (14-19, D-09)", () => {
  it("behaves as before with no provider and with an unrestricted provider", () => {
    const { unmount } = render(modal());
    const confirm = screen.getByRole("button", { name: "Cancel cohort" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(confirm.hasAttribute("aria-describedby")).toBe(false);
    unmount();

    render(within(NOT_RESTRICTED, modal()));
    expect((screen.getByRole("button", { name: "Cancel cohort" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/restricted continuity mode/i)).toBeNull();
  });

  it("disables a default (write) confirm in restricted state with the staff reason for staff without licence.view", () => {
    render(within(RESTRICTED_STAFF, modal()));
    const confirm = screen.getByRole("button", { name: "Cancel cohort" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const reason = document.getElementById(confirm.getAttribute("aria-describedby")!)!;
    expect(reason.textContent).toBe(RESTRICTED_CONTROL_REASON_STAFF);
    expect(reason.textContent).not.toMatch(/Open Licence/);
    // Cancel stays usable so the dialog can always be closed.
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the Open Licence reason to holders of licence.view", () => {
    render(within(RESTRICTED_ADMIN, modal()));
    const confirm = screen.getByRole("button", { name: "Cancel cohort" });
    expect(document.getElementById(confirm.getAttribute("aria-describedby")!)!.textContent).toBe(
      RESTRICTED_CONTROL_REASON_ADMIN,
    );
  });

  it("keeps a continuity confirm enabled and renders no reason line", () => {
    render(within(RESTRICTED_ADMIN, modal({ licenceEffect: "continuity" })));
    const confirm = screen.getByRole("button", { name: "Cancel cohort" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(confirm.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText(RESTRICTED_CONTROL_REASON_ADMIN)).toBeNull();
  });

  it("never calls onConfirm from a restricted write confirm", () => {
    let calls = 0;
    render(within(RESTRICTED_STAFF, modal({ onConfirm: () => void (calls += 1) })));
    screen.getByRole("button", { name: "Cancel cohort" }).click();
    expect(calls).toBe(0);
  });

  it("keeps focus inside the dialog when the confirm is disabled", () => {
    render(within(RESTRICTED_STAFF, modal()));
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("renders a licence refusal in the error slot as a warning note, not the standard danger error", () => {
    render(modal({ error: LICENCE_REFUSAL_MESSAGE }));
    const note = screen.getByRole("status");
    expect(note.textContent).toContain(LICENCE_REFUSAL_MESSAGE);
    expect(note.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(note.className).not.toContain("danger");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Action not applied")).toBeNull();
  });

  it("keeps the standard 'action not applied' rendering for any other error text", () => {
    render(modal({ error: "Your role does not permit this action." }));
    expect(screen.getByRole("alert").textContent).toContain("Action not applied");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("ResourceForm licence mirror (14-19, D-09)", () => {
  it("behaves as before with no provider", () => {
    render(form());
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the built-in submit in restricted state, described by the reason, and leaves Cancel enabled", () => {
    const { container } = render(within(RESTRICTED_STAFF, form()));
    const submit = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(document.getElementById(submit.getAttribute("aria-describedby")!)!.textContent).toBe(
      RESTRICTED_CONTROL_REASON_STAFF,
    );
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    expectEveryDisabledButtonHasReason(container);
  });

  it("shows the Open Licence reason to holders of licence.view", () => {
    render(within(RESTRICTED_ADMIN, form()));
    const submit = screen.getByRole("button", { name: "Save" });
    expect(document.getElementById(submit.getAttribute("aria-describedby")!)!.textContent).toBe(
      RESTRICTED_CONTROL_REASON_ADMIN,
    );
  });

  it("keeps the submit enabled with licenceEffect continuity", () => {
    render(within(RESTRICTED_STAFF, form({ licenceEffect: "continuity" })));
    const submit = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(screen.queryByText(RESTRICTED_CONTROL_REASON_STAFF)).toBeNull();
  });

  it("renders a licence refusal in the error state as a warning note", () => {
    render(form({ state: { status: "error", message: LICENCE_REFUSAL_MESSAGE } }));
    const note = screen.getByRole("status");
    expect(note.textContent).toContain(LICENCE_REFUSAL_MESSAGE);
    expect(note.className).not.toContain("danger");
  });

  it("keeps the plain message for any other error-state text", () => {
    render(form({ state: { status: "error", message: "The request failed." } }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("The request failed.")).toBeTruthy();
  });

  it("renders a licence refusal supplied as a form error through the warning note, not the danger summary", () => {
    render(form({ errors: [{ name: "form", message: LICENCE_REFUSAL_MESSAGE }] }));
    expect(screen.getByRole("status").textContent).toContain(LICENCE_REFUSAL_MESSAGE);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/issue needs attention/)).toBeNull();
  });

  it("keeps the danger summary for ordinary field errors", () => {
    render(form({ errors: [{ name: "title", message: "Title is required" }] }));
    expect(screen.getByRole("alert").textContent).toContain("1 issue needs attention");
  });
});

describe("restricted-control reason pairing (14-19, UI Considerations: disabled-state clarity)", () => {
  it("pairs every restriction-disabled button in a mixed screen with a resolvable, visible reason", () => {
    const { container } = render(
      within(
        RESTRICTED_ADMIN,
        <>
          {form()}
          {modal()}
        </>,
      ),
    );
    const disabled = container.ownerDocument.querySelectorAll("button:disabled");
    expect(disabled.length).toBe(2);
    expectEveryDisabledButtonHasReason(container.ownerDocument.body);
  });
});

describe("LicenceRefusalNote and RestrictedControlReason (14-19)", () => {
  it("defaults the refusal note to the licence refusal sentence and never uses danger styling", () => {
    const { container } = render(<LicenceRefusalNote />);
    expect(screen.getByRole("status").textContent).toBe(LICENCE_REFUSAL_MESSAGE);
    expect(container.innerHTML).not.toContain("danger");
    expect(container.innerHTML).toContain("border-warning");
    expect(container.innerHTML).toContain("bg-warning-surface");
  });

  it("never uses the retired post-grace wording anywhere in the restricted copy", () => {
    const { container } = render(
      <>
        <LicenceRefusalNote />
        <RestrictedControlReason id="a" canViewLicence={false} />
        <RestrictedControlReason id="b" canViewLicence />
      </>,
    );
    expect(container.textContent).not.toMatch(new RegExp(["read", "-", "only"].join(""), "i"));
  });
});
