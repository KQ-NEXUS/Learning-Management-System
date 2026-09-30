import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell } from "@/components/notifications/NotificationBell";

// The bell mounts NotificationDrawer once opened (Task 2), which reads the
// router — irrelevant to this file's badge/poll assertions, so a minimal stub.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/notifications/actions", () => ({
  openNotificationAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setVisibility("visible");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NotificationBell badge (zero-one-many)", () => {
  it("hides the badge and uses the zero aria-label at 0", () => {
    render(<NotificationBell initialUnread={0} variant="learner" />);
    const button = screen.getByRole("button", { name: "Notifications" });
    expect(button.querySelector('[data-testid="notification-badge"]')).toBeNull();
  });

  it("shows 1 at the lower bound", () => {
    render(<NotificationBell initialUnread={1} variant="learner" />);
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
    expect(screen.getByTestId("notification-badge").textContent).toBe("1");
  });

  it("shows 99 at the upper plain-number bound", () => {
    render(<NotificationBell initialUnread={99} variant="learner" />);
    expect(screen.getByRole("button", { name: "Notifications, 99 unread" })).toBeTruthy();
    expect(screen.getByTestId("notification-badge").textContent).toBe("99");
  });

  it("shows 99+ starting at 100", () => {
    render(<NotificationBell initialUnread={100} variant="learner" />);
    expect(screen.getByRole("button", { name: "Notifications, 100 unread" })).toBeTruthy();
    expect(screen.getByTestId("notification-badge").textContent).toBe("99+");
  });

  it("shows 99+ well above the cap", () => {
    render(<NotificationBell initialUnread={250} variant="learner" />);
    expect(screen.getByRole("button", { name: "Notifications, 250 unread" })).toBeTruthy();
    expect(screen.getByTestId("notification-badge").textContent).toBe("99+");
  });
});

describe("NotificationBell open state", () => {
  it("toggles aria-expanded on click", () => {
    render(<NotificationBell initialUnread={0} variant="staff" />);
    const button = screen.getByRole("button", { name: "Notifications" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("NotificationBell poll (D-22)", () => {
  it("fetches exactly once per 60 seconds while visible, with no-store", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unread: 3 }));
    render(<NotificationBell initialUnread={0} variant="learner" />);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/unread", { cache: "no-store" });
    expect(screen.getByTestId("notification-badge").textContent).toBe("3");
  });

  it("never fetches while the tab is hidden", async () => {
    setVisibility("hidden");
    render(<NotificationBell initialUnread={0} variant="learner" />);

    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches immediately on becoming visible and pauses again once hidden", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unread: 2 }));
    render(<NotificationBell initialUnread={0} variant="learner" />);

    setVisibility("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous count on a rejected fetch", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    render(<NotificationBell initialUnread={4} variant="learner" />);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(screen.getByTestId("notification-badge").textContent).toBe("4");
  });

  it("keeps the previous count on a 401 response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unread: 0 }, false));
    render(<NotificationBell initialUnread={4} variant="learner" />);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(screen.getByTestId("notification-badge").textContent).toBe("4");
  });

  it("clears the interval on unmount", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unread: 9 }));
    const { unmount } = render(<NotificationBell initialUnread={0} variant="learner" />);
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("NotificationBell prop reset", () => {
  it("replaces state when a new initialUnread prop arrives", () => {
    const { rerender } = render(<NotificationBell initialUnread={2} variant="learner" />);
    expect(screen.getByTestId("notification-badge").textContent).toBe("2");
    rerender(<NotificationBell initialUnread={7} variant="learner" />);
    expect(screen.getByTestId("notification-badge").textContent).toBe("7");
  });
});
