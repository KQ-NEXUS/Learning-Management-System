"use client";

/**
 * Right-side slide-over notification drawer (D-18, D-19, D-21).
 *
 * Portalled to `document.body` so header stacking contexts and the staff
 * mobile-nav isolation (`inert`) never clip or hide it. Opening the drawer
 * fetches the list but never mutates anything (D-19) — read state only
 * changes when an item is activated or "Mark all read" runs. Rendered only
 * while `open` is true (the parent unmounts it on close), which doubles as
 * the "fetch on open" trigger: every mount is a fresh open.
 */

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, X } from "lucide-react";
import { BTN } from "@/components/primitives/controls";
import type { NotificationDto } from "@/server/communications/notification-text";
import {
  markAllNotificationsReadAction,
  openNotificationAction,
} from "@/app/notifications/actions";
import { NotificationItem, type NotificationItemView } from "./NotificationItem";
import { EmailPreferencesPanel } from "./EmailPreferencesPanel";

export type NotificationDrawerVariant = "learner" | "staff";

const PAGE_SIZE = 20;
const EMPTY_HEADING = "You're all caught up";
const EMPTY_BODY: Record<NotificationDrawerVariant, string> = {
  learner: "New updates about your enrolments, results and support tickets will appear here.",
  staff: "New tickets, submissions and payment alerts will appear here.",
};
const LOAD_ERROR = "Couldn't load notifications. Check your connection and try again.";
const MARK_ALL_ERROR = "Couldn't mark all read. Try again.";
const OPEN_FAILURE = "Couldn't open this item. Try again.";

const FOCUSABLE =
  "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

type ListStatus = "loading" | "ready" | "error";
type DrawerView = "list" | "preferences";

async function fetchNotificationsPage(
  cursor: string | null,
): Promise<{ items: NotificationDto[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/notifications?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to load notifications.");
  }
  return (await response.json()) as { items: NotificationDto[]; nextCursor: string | null };
}

export function NotificationDrawer({
  open,
  onClose,
  variant,
  onUnreadChange,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  variant: NotificationDrawerVariant;
  onUnreadChange: (updater: number | ((previous: number) => number)) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const router = useRouter();
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const previousViewRef = useRef<DrawerView>("list");

  const [view, setView] = useState<DrawerView>("list");
  const [status, setStatus] = useState<ListStatus>("loading");
  const [items, setItems] = useState<NotificationItemView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markAllError, setMarkAllError] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [itemErrorId, setItemErrorId] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  // `Date.now()` is impure and must not be called during render
  // (react-hooks/purity) — captured once via an effect instead.
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Used by the "Try again" click handler only — a direct setState call is
  // fine there (it is not inside an effect body).
  async function loadFirstPage() {
    setStatus("loading");
    try {
      const page = await fetchNotificationsPage(null);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  // Fetch once on mount (every open is a fresh mount — see file header).
  // `.then`/`.catch` attached directly here (not routed through an async
  // function called from the effect body) is the pattern this codebase's
  // eslint react-compiler rules accept for an effect-triggered fetch
  // (react-hooks/set-state-in-effect — see UploadPanel.tsx's identical
  // `loadResources(...).then(setResources).catch(...)` shape).
  useEffect(() => {
    let cancelled = false;
    fetchNotificationsPage(null)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the heading on open (keyboard/focus backstop, UI-SPEC).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Lock body scroll for the lifetime of the (mounted-while-open) drawer.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // Slide-in transform: starts off-screen, animates in on the next frame.
  // The global prefers-reduced-motion rule (globals.css) collapses the
  // transition duration itself — nothing reduced-motion-specific here.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Deferred via requestAnimationFrame (mirrors the `entered` effect above)
  // rather than a bare top-level setState call in the effect body.
  useEffect(() => {
    const id = requestAnimationFrame(() => setNowMs(Date.now()));
    return () => cancelAnimationFrame(id);
  }, []);

  // Focus returns to the gear when backing out of the preferences view
  // (D-18) — but not on the initial mount, when the heading itself takes
  // focus instead (the effect above).
  useEffect(() => {
    if (previousViewRef.current === "preferences" && view === "list") {
      gearRef.current?.focus();
    }
    previousViewRef.current = view;
  }, [view]);

  function closeDrawer(restoreFocus: boolean) {
    if (restoreFocus) triggerRef.current?.focus();
    onClose();
  }

  function handleBack() {
    setView("list");
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchNotificationsPage(nextCursor);
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // Silent — "Load older" simply stays put; the user can press it again.
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleMarkAllRead() {
    if (markingAll) return;
    const previousItems = items;
    setMarkingAll(true);
    setMarkAllError(false);
    setItems((previous) => previous.map((item) => ({ ...item, read: true })));
    try {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) throw new Error(result.message);
      onUnreadChange(0);
    } catch {
      setItems(previousItems);
      setMarkAllError(true);
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleActivate(id: string) {
    if (activatingId) return;
    const target = items.find((item) => item.id === id);
    if (!target || target.stale) return;
    const wasUnread = !target.read;

    setItemErrorId(null);
    setActivatingId(id);
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, read: true } : item)),
    );

    let result;
    try {
      result = await openNotificationAction({ id });
    } catch {
      result = { ok: false as const, message: OPEN_FAILURE };
    }
    setActivatingId(null);

    if (!result.ok) {
      setItems((previous) =>
        previous.map((item) => (item.id === id ? { ...item, read: target.read } : item)),
      );
      setItemErrorId(id);
      return;
    }

    if (result.unavailable) {
      setItems((previous) =>
        previous.map((item) => (item.id === id ? { ...item, read: true, stale: true } : item)),
      );
      if (wasUnread) onUnreadChange((previous) => Math.max(0, previous - 1));
      return;
    }

    if (wasUnread) onUnreadChange((previous) => Math.max(0, previous - 1));
    router.push(result.href);
    closeDrawer(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDrawer(true);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === headingRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  const todayItems = items.filter((item) => item.group === "today");
  const earlierItems = items.filter((item) => item.group === "earlier");
  const markAllDisabled = markingAll || items.length === 0 || items.every((item) => item.read);

  return createPortal(
    <div
      onKeyDown={onKeyDown}
      onClick={() => closeDrawer(true)}
      className="fixed inset-0 z-50 bg-foreground/40"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
        className={`ml-auto flex h-full w-full flex-col bg-surface shadow-card transition-transform duration-200 sm:w-[400px] ${
          entered ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-2 px-4">
          {view === "preferences" && (
            <button
              type="button"
              aria-label="Back to notifications"
              onClick={handleBack}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-surface-2"
            >
              <ArrowLeft aria-hidden className="size-5" />
            </button>
          )}
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="flex-1 truncate text-xl font-semibold text-foreground outline-none"
          >
            {view === "preferences" ? "Email preferences" : "Notifications"}
          </h2>
          {view === "list" && variant === "learner" && (
            <button
              type="button"
              ref={gearRef}
              aria-label="Email preferences"
              onClick={() => setView("preferences")}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-surface-2"
            >
              <Settings aria-hidden className="size-5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={() => closeDrawer(true)}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-surface-2"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        {view === "preferences" ? (
          <EmailPreferencesPanel />
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-end px-4 pb-2">
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                disabled={markAllDisabled}
                className="text-sm font-semibold text-accent hover:underline disabled:opacity-50 disabled:no-underline"
              >
                Mark all read
              </button>
            </div>
            {markAllError && (
              <div role="alert" className="px-4 pb-2 text-sm text-danger">
                {MARK_ALL_ERROR}
              </div>
            )}

            <div
              className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
              aria-busy={status === "loading"}
            >
              {status === "loading" && (
                <ul aria-hidden className="flex flex-col gap-1 px-2 pt-2">
                  {[0, 1, 2, 3].map((index) => (
                    <li key={index} className="h-12 animate-pulse rounded-md bg-surface-2" />
                  ))}
                </ul>
              )}

              {status === "error" && (
                <div className="flex flex-col items-start gap-3 px-2 py-6">
                  <p className="text-sm text-foreground">{LOAD_ERROR}</p>
                  <button type="button" onClick={() => void loadFirstPage()} className={BTN}>
                    Try again
                  </button>
                </div>
              )}

              {status === "ready" && items.length === 0 && (
                <div className="flex flex-col items-start gap-1 px-2 py-6">
                  <h3 className="text-base font-semibold text-foreground">{EMPTY_HEADING}</h3>
                  <p className="text-sm text-muted-foreground">{EMPTY_BODY[variant]}</p>
                </div>
              )}

              {status === "ready" && items.length > 0 && (
                <>
                  {todayItems.length > 0 && (
                    <>
                      <p className="px-2 pt-2 pb-1 text-sm text-muted-foreground">Today</p>
                      <ul>
                        {todayItems.map((item) => (
                          <NotificationItem
                            key={item.id}
                            notification={item}
                            pending={activatingId === item.id}
                            openError={itemErrorId === item.id}
                            now={nowMs}
                            onActivate={(id) => void handleActivate(id)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {earlierItems.length > 0 && (
                    <>
                      <p className="px-2 pt-2 pb-1 text-sm text-muted-foreground">Earlier</p>
                      <ul>
                        {earlierItems.map((item) => (
                          <NotificationItem
                            key={item.id}
                            notification={item}
                            pending={activatingId === item.id}
                            openError={itemErrorId === item.id}
                            now={nowMs}
                            onActivate={(id) => void handleActivate(id)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>

            {status === "ready" && nextCursor && (
              <div className="shrink-0 border-t border-border px-4 py-3">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className={`${BTN} w-full`}
                >
                  {loadingMore ? "Loading…" : "Load older"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
