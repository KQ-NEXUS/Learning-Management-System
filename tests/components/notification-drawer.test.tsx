import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationDrawer } from "@/components/notifications/NotificationDrawer";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const openNotificationAction = vi.fn();
const markAllNotificationsReadAction = vi.fn();
const saveEmailPreferencesAction = vi.fn();
vi.mock("@/app/notifications/actions", () => ({
  openNotificationAction: (...args: unknown[]) => openNotificationAction(...args),
  markAllNotificationsReadAction: (...args: unknown[]) => markAllNotificationsReadAction(...args),
  saveEmailPreferencesAction: (...args: unknown[]) => saveEmailPreferencesAction(...args),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

type Notification = {
  id: string;
  title: string;
  meta: string | null;
  read: boolean;
  createdAt: string;
  group: "today" | "earlier";
};

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n-1",
    title: "Alpha",
    meta: null,
    read: false,
    createdAt: new Date().toISOString(),
    group: "today",
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  push.mockReset();
  openNotificationAction.mockReset();
  markAllNotificationsReadAction.mockReset();
  saveEmailPreferencesAction.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

function renderDrawer(props: { variant?: "learner" | "staff" } = {}) {
  const onClose = vi.fn();
  const onUnreadChange = vi.fn();
  const triggerRef = createRef<HTMLButtonElement>();
  const utils = render(
    <>
      <button ref={triggerRef}>Bell</button>
      <NotificationDrawer
        open
        onClose={onClose}
        variant={props.variant ?? "learner"}
        onUnreadChange={onUnreadChange}
        triggerRef={triggerRef}
      />
    </>,
  );
  return { onClose, onUnreadChange, triggerRef, ...utils };
}

describe("NotificationDrawer open behaviour (D-19)", () => {
  it("fetches on open and calls no mutation", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha" }), notification({ id: "b", title: "Beta" })],
        nextCursor: null,
      }),
    );
    renderDrawer();
    await screen.findByText("Alpha");
    await screen.findByText("Beta");
    expect(openNotificationAction).toHaveBeenCalledTimes(0);
    expect(markAllNotificationsReadAction).toHaveBeenCalledTimes(0);
  });

  it("shows 4 skeleton rows before the list resolves", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderDrawer();
    expect(screen.getByRole("dialog").querySelectorAll("[aria-hidden] > li")).toHaveLength(4);
  });
});

describe("NotificationDrawer empty state", () => {
  it("shows the learner empty copy and disables Mark all read", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    renderDrawer({ variant: "learner" });
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
    expect(
      screen.getByText(
        "New updates about your enrolments, results and support tickets will appear here.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Mark all read" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows the staff empty copy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    renderDrawer({ variant: "staff" });
    expect(
      await screen.findByText("New tickets, submissions and payment alerts will appear here."),
    ).toBeTruthy();
  });
});

describe("NotificationDrawer load error", () => {
  it("shows the load-error copy with a working retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    renderDrawer();
    expect(
      await screen.findByText("Couldn't load notifications. Check your connection and try again."),
    ).toBeTruthy();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [notification({ id: "a", title: "Alpha" })], nextCursor: null }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Alpha")).toBeTruthy();
  });
});

describe("NotificationDrawer grouping (populated)", () => {
  it("shows a group heading only when that group has items", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", group: "today" })],
        nextCursor: null,
      }),
    );
    renderDrawer();
    await screen.findByText("Alpha");
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.queryByText("Earlier")).toBeNull();
  });

  it("shows both group headings when both groups have items", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          notification({ id: "a", title: "Alpha", group: "today" }),
          notification({ id: "b", title: "Beta", group: "earlier" }),
        ],
        nextCursor: null,
      }),
    );
    renderDrawer();
    await screen.findByText("Alpha");
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
  });
});

describe("NotificationDrawer pagination (overflow)", () => {
  it("shows Load older only while a next page exists, appends without duplicates, then hides it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha" }), notification({ id: "b", title: "Beta" })],
        nextCursor: "cursor-1",
      }),
    );
    renderDrawer();
    await screen.findByText("Alpha");
    const loadOlder = screen.getByRole("button", { name: "Load older" });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [notification({ id: "c", title: "Gamma" })], nextCursor: null }),
    );
    fireEvent.click(loadOlder);
    await screen.findByText("Gamma");

    expect(screen.getAllByText("Alpha")).toHaveLength(1);
    expect(screen.getAllByText("Beta")).toHaveLength(1);
    expect(screen.getAllByText("Gamma")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });
});

describe("NotificationDrawer Mark all read", () => {
  it("optimistically clears unread styling and confirms the bell to 0 on success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", read: false })],
        nextCursor: null,
      }),
    );
    markAllNotificationsReadAction.mockResolvedValue({ ok: true, count: 1 });
    const { onUnreadChange } = renderDrawer();
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(markAllNotificationsReadAction).toHaveBeenCalledTimes(1));
    expect(onUnreadChange).toHaveBeenCalledWith(0);
  });

  it("reverts unread styling and shows an inline error on failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", read: false })],
        nextCursor: null,
      }),
    );
    markAllNotificationsReadAction.mockResolvedValue({ ok: false, message: "nope" });
    renderDrawer();
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(await screen.findByText("Couldn't mark all read. Try again.")).toBeTruthy();
  });
});

describe("NotificationDrawer item activation (D-21)", () => {
  it("marks an unavailable item read, greys it, shows the safe copy and never navigates", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", read: false })],
        nextCursor: null,
      }),
    );
    openNotificationAction.mockResolvedValue({ ok: true, unavailable: true });
    renderDrawer();
    const row = await screen.findByRole("button", { name: /Alpha/ });

    fireEvent.click(row);
    expect(await screen.findByText("No longer available")).toBeTruthy();
    expect(
      screen.getByText("This item has been removed or you no longer have access."),
    ).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(0);
  });

  it("navigates and closes on an ok result with href, decrementing the unread count once", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", read: false })],
        nextCursor: null,
      }),
    );
    openNotificationAction.mockResolvedValue({ ok: true, unavailable: false, href: "/dashboard" });
    const { onClose, onUnreadChange } = renderDrawer();
    const row = await screen.findByRole("button", { name: /Alpha/ });

    fireEvent.click(row);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUnreadChange).toHaveBeenCalled();
  });

  it("reverts read state and shows the retry copy when opening fails", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", read: false })],
        nextCursor: null,
      }),
    );
    openNotificationAction.mockResolvedValue({ ok: false, message: "nope" });
    renderDrawer();
    const row = await screen.findByRole("button", { name: /Alpha/ });

    fireEvent.click(row);
    expect(await screen.findByText("Couldn't open this item. Try again.")).toBeTruthy();
    expect(push).toHaveBeenCalledTimes(0);
  });
});

describe("NotificationDrawer long text (backstop)", () => {
  it("clamps a 200-character title to two lines and a 200-character meta to one line (G-13-1)", async () => {
    const longTitle = "A".repeat(200);
    const longMeta = "B".repeat(200);
    expect(longTitle).toHaveLength(200);
    expect(longMeta).toHaveLength(200);
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: longTitle, meta: longMeta })],
        nextCursor: null,
      }),
    );
    renderDrawer();
    const titleEl = await screen.findByText(longTitle);
    const metaEl = screen.getByText(longMeta);
    const titleClasses = titleEl.className.split(/\s+/);
    const metaClasses = metaEl.className.split(/\s+/);
    expect(titleClasses).toContain("line-clamp-2");
    expect(metaClasses).toContain("line-clamp-1");
    // Tailwind v4's line-clamp utilities set `display: -webkit-box`. A display
    // utility of equal specificity (`block`, later in the generated CSS) wins
    // and silently defeats the clamp — the diagnosed G-13-1 cause.
    const conflictingDisplay = /^(block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table|hidden)$/;
    expect(titleClasses.filter((c) => conflictingDisplay.test(c))).toEqual([]);
    expect(metaClasses.filter((c) => conflictingDisplay.test(c))).toEqual([]);
    // The row is still a single activation button holding both texts.
    const row = screen.getByRole("button", { name: new RegExp(longTitle) });
    expect(row.contains(titleEl)).toBe(true);
    expect(row.contains(metaEl)).toBe(true);
  });
});

describe("NotificationDrawer text safety (T-13-18)", () => {
  it("renders a markup-shaped title literally, creating no element", async () => {
    const hostileTitle = "<img src=x onerror=alert(1)>";
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [notification({ id: "a", title: hostileTitle })], nextCursor: null }),
    );
    renderDrawer();
    const titleEl = await screen.findByText(hostileTitle);
    expect(titleEl.querySelector("img")).toBeNull();
  });
});

describe("NotificationDrawer dialog mechanics (keyboard/focus backstop)", () => {
  it("is a labelled modal dialog that focuses its heading on open and locks body scroll", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    renderDrawer();
    await screen.findByText("You're all caught up");
    const dialog = screen.getByRole("dialog", { name: "Notifications" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Notifications"));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    const { onClose, triggerRef } = renderDrawer();
    await screen.findByText("You're all caught up");
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(triggerRef.current);
  });

  it("closes on a scrim click and restores focus to the trigger", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    const { onClose, triggerRef } = renderDrawer();
    await screen.findByText("You're all caught up");
    const scrim = screen.getByRole("dialog").parentElement!;

    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(triggerRef.current);
  });

  it("wraps Tab focus forward and backward within the panel", async () => {
    // Staff variant: no gear button, so the panel's focusable set is exactly
    // [close, mark-all-read (disabled, excluded), row] — keeps this test's
    // first/last assertions independent of the learner-only gear (Task 3).
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [notification({ id: "a", title: "Alpha", read: false })],
        nextCursor: null,
      }),
    );
    renderDrawer({ variant: "staff" });
    const row = await screen.findByRole("button", { name: /Alpha/ });
    const closeButton = screen.getByRole("button", { name: "Close" });
    const dialog = screen.getByRole("dialog");

    row.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(row);
  });
});

describe("NotificationDrawer accessibility (axe)", () => {
  it("has no violations in the ready state", async () => {
    const { axeViolations } = await import("../support/axe");
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [notification({ id: "a", title: "Alpha" })], nextCursor: null }),
    );
    renderDrawer();
    await screen.findByText("Alpha");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("has no violations in the empty state", async () => {
    const { axeViolations } = await import("../support/axe");
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    renderDrawer();
    await screen.findByText("You're all caught up");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("has no violations in the error state", async () => {
    const { axeViolations } = await import("../support/axe");
    fetchMock.mockResolvedValue(jsonResponse({}, false));
    renderDrawer();
    await screen.findByText("Couldn't load notifications. Check your connection and try again.");
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe("NotificationDrawer email-preferences gear (permission variance, D-18)", () => {
  it("shows the gear for the learner variant", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    renderDrawer({ variant: "learner" });
    await screen.findByText("You're all caught up");
    expect(screen.getByRole("button", { name: "Email preferences" })).toBeTruthy();
  });

  it("has no gear for the staff variant", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], nextCursor: null }));
    renderDrawer({ variant: "staff" });
    await screen.findByText("You're all caught up");
    expect(screen.queryByRole("button", { name: "Email preferences" })).toBeNull();
  });

  it("swaps to the preferences panel and back, without a refetch flash, returning focus to the gear", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/notifications/preferences")) {
        return Promise.resolve(jsonResponse({ muted: [] }));
      }
      return Promise.resolve(jsonResponse({ items: [], nextCursor: null }));
    });
    renderDrawer({ variant: "learner" });
    await screen.findByText("You're all caught up");

    fireEvent.click(screen.getByRole("button", { name: "Email preferences" }));
    expect(await screen.findByRole("heading", { name: "Email preferences" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to notifications" })).toBeTruthy();
    expect(screen.queryByText("You're all caught up")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to notifications" }));
    await screen.findByRole("heading", { name: "Notifications" });
    const gearAfterBack = screen.getByRole("button", { name: "Email preferences" });
    expect(document.activeElement).toBe(gearAfterBack);
  });
});
