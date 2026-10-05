import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RowActionMenu } from "@/components/primitives/RowActionMenu";
import { EnrolmentRowActions } from "@/app/staff/cohorts/[id]/EnrolmentRowActions";

afterEach(cleanup);

function setup(onTransfer = vi.fn(), onWithdraw = vi.fn()) {
  render(
    <RowActionMenu
      label="Actions for Ada Obi"
      items={[
        { key: "withdraw", label: "Withdraw", destructive: true, onSelect: onWithdraw },
        { key: "transfer", label: "Transfer", onSelect: onTransfer },
      ]}
    />,
  );
  return screen.getByRole("button", { name: "Actions for Ada Obi" });
}

const items = () => screen.getAllByRole("menuitem").map((el) => el.textContent);

describe("RowActionMenu", () => {
  it("names the row on the button and starts closed", () => {
    const button = setup();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click, lists safe items first and destructive ones last, and focuses the first item", () => {
    const button = setup();
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "Actions for Ada Obi" })).toBeTruthy();
    expect(items()).toEqual(["Transfer", "Withdraw"]);
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Transfer");
  });

  it("moves with the arrow keys, wrapping, and Home and End", () => {
    fireEvent.click(setup());
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Withdraw");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Transfer");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Withdraw");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toBe("Transfer");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Withdraw");
  });

  it("ArrowUp on the button opens the menu on the last item", () => {
    const button = setup();
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Withdraw");
  });

  it("Escape closes the menu and returns focus to the button", () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("Tab closes the menu and returns focus to the button", () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("a press outside closes it", () => {
    fireEvent.click(setup());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("choosing an item closes the menu, focuses the button, then runs the item", () => {
    const order: string[] = [];
    const onWithdraw = vi.fn(() => order.push(`ran with focus on ${document.activeElement?.getAttribute("aria-label")}`));
    const button = setup(vi.fn(), onWithdraw);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Withdraw" }));

    expect(screen.queryByRole("menu")).toBeNull();
    expect(order).toEqual(["ran with focus on Actions for Ada Obi"]);
  });
});

describe("EnrolmentRowActions", () => {
  const props = { cohortId: "c1", enrolmentId: "e1", learnerName: "Ada Obi" };

  it("offers Approve and Cancel while payment is pending", () => {
    render(<EnrolmentRowActions {...props} status="PENDING_PAYMENT" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ada Obi" }));
    expect(items()).toEqual(["Approve", "Cancel enrolment"]);
  });

  it("offers Transfer, Withdraw and Cancel for an active enrolment, and opens the matching dialog", () => {
    const onOpen = vi.fn();
    render(<EnrolmentRowActions {...props} status="ACTIVE" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Ada Obi" }));
    expect(items()).toEqual(["Transfer", "Withdraw", "Cancel enrolment"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Withdraw" }));
    expect(onOpen).toHaveBeenCalledWith({ action: "withdraw", cohortId: "c1", enrolmentId: "e1", learnerName: "Ada Obi" });
  });

  it("shows no menu for an enrolment with nothing left to do", () => {
    render(<EnrolmentRowActions {...props} status="WITHDRAWN" onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
