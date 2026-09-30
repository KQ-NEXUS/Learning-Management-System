/**
 * One notification row (D-18, D-21, T-13-18).
 *
 * Presentational only — the drawer owns the fetch/mutation state and passes
 * every visual flag in as a prop. All text renders as plain React text
 * nodes (never `dangerouslySetInnerHTML`), so a title containing
 * angle-bracket markup shows up literally instead of becoming an element.
 */

import type { NotificationDto } from "@/server/communications/notification-text";

const STALE_TITLE = "No longer available";
const STALE_META = "This item has been removed or you no longer have access.";
const OPEN_ERROR = "Couldn't open this item. Try again.";

export type NotificationItemView = NotificationDto & { stale?: boolean };

export type NotificationItemProps = {
  notification: NotificationItemView;
  pending: boolean;
  openError: boolean;
  /**
   * The drawer's own captured `Date.now()`, taken once via an effect (never
   * read here — `Date.now()` is impure and must not be called during
   * render, react-hooks/purity). `null` for the one render before that
   * effect runs; the timestamp is simply blank for that instant.
   */
  now: number | null;
  onActivate: (id: string) => void;
};

/** A short, deterministic-enough relative label. Never computed on the server (T-13-22 client-only fetch), so no hydration mismatch risk. */
function relativeTime(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (diffSeconds < 60) return "Just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotificationItem({
  notification,
  pending,
  openError,
  now,
  onActivate,
}: NotificationItemProps) {
  const { id, title, meta, read, stale, createdAt } = notification;
  const unread = !read && !stale;
  const displayTitle = stale ? STALE_TITLE : title;
  const displayMeta = stale ? STALE_META : meta;

  return (
    <li className="list-none">
      <button
        type="button"
        disabled={pending || stale}
        onClick={() => onActivate(id)}
        className={`flex min-h-12 w-full items-start gap-2 rounded-md px-4 py-3 text-left ${
          unread ? "bg-accent-wash" : stale ? "" : "hover:bg-surface-2"
        }`}
      >
        <span
          aria-hidden
          className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`}
        />
        <span className="min-w-0 flex-1">
          <span
            className={`line-clamp-2 text-sm ${
              unread ? "font-semibold text-foreground" : "font-normal text-muted-foreground"
            }`}
          >
            {displayTitle}
          </span>
          {displayMeta && (
            <span className="line-clamp-1 text-sm text-muted-foreground">{displayMeta}</span>
          )}
          {openError && <span className="block text-sm text-danger">{OPEN_ERROR}</span>}
        </span>
        <span className="shrink-0 text-sm text-muted-foreground">
          {now !== null ? relativeTime(createdAt, now) : ""}
        </span>
      </button>
    </li>
  );
}
