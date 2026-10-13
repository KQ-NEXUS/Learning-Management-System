/**
 * R3-12 (owner decisions 2026-10-04): the temporary-password notice is a
 * passing reminder. It hides itself after a short time, has a Dismiss button,
 * and stays hidden on that browser once dismissed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  AUTO_HIDE_MS,
  DISMISS_FOR_DAYS,
  DISMISSED_UNTIL_KEY,
  TemporaryPasswordNotice,
} from "@/components/shell/TemporaryPasswordNotice";

const NOW = new Date("2026-10-04T09:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const notice = () => screen.queryByText(/We recommend choosing your own/);
/** Renders and lets the notice decide, in the browser, whether it was dismissed before. */
function mount() {
  const view = render(<TemporaryPasswordNotice />);
  act(() => void vi.advanceTimersByTime(0));
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("TemporaryPasswordNotice", () => {
  it("renders nothing until the browser has checked for an earlier dismissal, so it never flashes", () => {
    render(<TemporaryPasswordNotice />);
    expect(notice()).toBeNull();
  });

  it("shows the suggestion with a link to the reset flow and a Dismiss button", () => {
    mount();

    expect(notice()).toBeTruthy();
    expect(screen.getByRole("link", { name: "Change password" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeTruthy();
  });

  it("hides itself after a short time, without recording a dismissal", () => {
    mount();

    act(() => void vi.advanceTimersByTime(AUTO_HIDE_MS - 1));
    expect(notice()).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
    expect(notice()).toBeNull();
    // It timed out; the person did not dismiss it, so the next sign-in reminds them again.
    expect(window.localStorage.getItem(DISMISSED_UNTIL_KEY)).toBeNull();
  });

  it("Dismiss hides it at once and keeps it hidden on the next page load", () => {
    const first = mount();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(notice()).toBeNull();
    expect(Number(window.localStorage.getItem(DISMISSED_UNTIL_KEY))).toBe(NOW.getTime() + DISMISS_FOR_DAYS * DAY_MS);
    first.unmount();

    mount();
    expect(notice()).toBeNull();
  });

  it("reminds again once the dismissal period has passed", () => {
    window.localStorage.setItem(DISMISSED_UNTIL_KEY, String(NOW.getTime() - 1));
    mount();
    expect(notice()).toBeTruthy();
  });

  it("still shows, and still dismisses, when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    mount();
    expect(notice()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(notice()).toBeNull();
  });
});
