"use client";

/**
 * Header bell with an unread badge (D-18, D-22, UI Considerations:
 * zero-one-many).
 *
 * The server renders the true count on every navigation (`initialUnread`);
 * this component keeps that count fresh with a light poll while the tab is
 * visible, never a websocket/SSE. A failed poll is silent and keeps the
 * previous count (T-13-29) — a database blip or a 401 from a since-expired
 * session must never make the badge lie loudly or crash the header.
 *
 * `initialUnread` wins on every navigation via the previous-prop-in-state
 * reset pattern (comparing the prop to a mirrored state value during render,
 * per React's documented "adjusting state when a prop changes" pattern) —
 * no effect sets state here, so a fresh server-rendered count is never
 * raced by a stale in-flight poll response from the previous page.
 */

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { NotificationDrawer } from "./NotificationDrawer";

const POLL_INTERVAL_MS = 60_000;
const BADGE_CAP = 99;

export type NotificationBellVariant = "learner" | "staff";

/** 0 hides the badge, 1-99 shows the number, 100+ shows "99+". */
function badgeLabel(count: number): string | null {
  if (count <= 0) return null;
  if (count > BADGE_CAP) return `${BADGE_CAP}+`;
  return String(count);
}

function bellAriaLabel(count: number): string {
  return count > 0 ? `Notifications, ${count} unread` : "Notifications";
}

export function NotificationBell({
  initialUnread,
  variant,
}: {
  initialUnread: number;
  variant: NotificationBellVariant;
}) {
  const [unread, setUnread] = useState(initialUnread);
  // Previous-prop-in-state reset: a new server-rendered count always wins,
  // without an effect (D-22).
  const [previousInitialUnread, setPreviousInitialUnread] = useState(initialUnread);
  if (previousInitialUnread !== initialUnread) {
    setPreviousInitialUnread(initialUnread);
    setUnread(initialUnread);
  }

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const response = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { unread?: unknown };
        if (!cancelled && typeof data.unread === "number") {
          setUnread(data.unread);
        }
      } catch {
        // Silent failure — keep the previous count (T-13-29).
      }
    }

    function start() {
      if (interval !== null) return;
      interval = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    }

    function stop() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void poll();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const badge = badgeLabel(unread);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={bellAriaLabel(unread)}
        onClick={() => setOpen((value) => !value)}
        className="relative flex size-11 shrink-0 items-center justify-center rounded-md text-sidebar-fg hover:bg-sidebar-hover"
      >
        <Bell aria-hidden className="size-5" />
        {badge && (
          <span
            aria-hidden
            data-testid="notification-badge"
            className="absolute top-0.5 right-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1 text-[14px] font-semibold text-accent-contrast"
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <NotificationDrawer
          open={open}
          onClose={() => setOpen(false)}
          variant={variant}
          onUnreadChange={setUnread}
          triggerRef={buttonRef}
        />
      )}
    </>
  );
}
