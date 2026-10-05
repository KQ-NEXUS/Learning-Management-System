/**
 * App-wide confirmations (owner request, 2026-10-04): a card in the corner says
 * what happened. Success fades after five seconds, an error stays until closed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ replace: vi.fn(), params: new URLSearchParams(), pathname: "/staff/courses/c1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.params,
}));

import { AUTO_DISMISS_MS, ToastProvider, useToast } from "@/components/feedback/Toaster";
import { FlashNotice } from "@/components/feedback/FlashNotice";
import { flashMessage, withFlash } from "@/lib/flash-notices";

function Buttons() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Learner withdrawn")}>ok</button>
      <button onClick={() => toast.error("Refund could not be recorded")}>fail</button>
      <button onClick={() => toast.info("Export queued")}>note</button>
      <button onClick={() => toast.success("   ")}>blank</button>
    </>
  );
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.useFakeTimers();
  nav.replace.mockReset();
  nav.params = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows a success message as a polite status and removes it after five seconds", () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    click("ok");

    const card = screen.getByRole("status");
    expect(card.textContent).toContain("Learner withdrawn");

    act(() => void vi.advanceTimersByTime(AUTO_DISMISS_MS - 1));
    expect(screen.queryByText("Learner withdrawn")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText("Learner withdrawn")).toBeNull();
  });

  it("an error is announced as an alert and stays until it is dismissed", () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    click("fail");

    expect(screen.getByRole("alert").textContent).toContain("Refund could not be recorded");
    act(() => void vi.advanceTimersByTime(AUTO_DISMISS_MS * 4));
    expect(screen.queryByText("Refund could not be recorded")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByText("Refund could not be recorded")).toBeNull();
  });

  it("holds a message open while the pointer is on it", () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    click("ok");
    const card = screen.getByRole("status");

    fireEvent.mouseEnter(card);
    act(() => void vi.advanceTimersByTime(AUTO_DISMISS_MS * 2));
    expect(screen.queryByText("Learner withdrawn")).toBeTruthy();

    fireEvent.mouseLeave(card);
    act(() => void vi.advanceTimersByTime(AUTO_DISMISS_MS));
    expect(screen.queryByText("Learner withdrawn")).toBeNull();
  });

  it("stacks different messages, shows a repeated one once, and ignores a blank one", () => {
    render(<ToastProvider><Buttons /></ToastProvider>);
    click("ok");
    click("ok");
    click("note");
    click("blank");

    expect(screen.getAllByRole("status").map((card) => card.textContent)).toEqual([
      expect.stringContaining("Learner withdrawn"),
      expect.stringContaining("Export queued"),
    ]);
  });

  it("useToast outside a provider does nothing rather than throwing", () => {
    render(<Buttons />);
    expect(() => click("ok")).not.toThrow();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("flash notices after a redirect", () => {
  it("adds the code to a path, keeping an existing query", () => {
    expect(withFlash("/staff/courses/c1", "course-created")).toBe("/staff/courses/c1?done=course-created");
    expect(withFlash("/staff/cohorts/c1?tab=sessions", "cohort-created")).toBe("/staff/cohorts/c1?tab=sessions&done=cohort-created");
  });

  it("only a listed code has a message", () => {
    expect(flashMessage("course-created")).toBe("Course created");
    for (const code of ["", "nope", "toString", "constructor", "<b>hi</b>"]) expect(flashMessage(code)).toBeNull();
  });

  it("shows the message for the code in the address, then removes the code", () => {
    nav.params = new URLSearchParams("tab=content&done=course-created");
    render(<ToastProvider><FlashNotice /></ToastProvider>);

    expect(screen.getByRole("status").textContent).toContain("Course created");
    expect(nav.replace).toHaveBeenCalledWith("/staff/courses/c1?tab=content", { scroll: false });
  });

  it("shows nothing for an unknown code, never the text from the address, and still cleans it up", () => {
    nav.params = new URLSearchParams("done=You+have+won+a+prize");
    render(<ToastProvider><FlashNotice /></ToastProvider>);

    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toContain("prize");
    expect(nav.replace).toHaveBeenCalledWith("/staff/courses/c1", { scroll: false });
  });

  it("does nothing when the address has no code", () => {
    render(<ToastProvider><FlashNotice /></ToastProvider>);
    expect(screen.queryByRole("status")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
