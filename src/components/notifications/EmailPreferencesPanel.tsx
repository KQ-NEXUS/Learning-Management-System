"use client";

/**
 * Learner-only email preference switches inside the drawer (D-16, D-19).
 *
 * Four optional categories can be muted; five always-emailed categories are
 * shown as a locked, non-interactive list so nobody mistakes them for
 * controls. Muting a category only stops the EMAIL for it — the in-product
 * notification is unaffected, which the intro copy says explicitly. This
 * component never touches `Notification` rows or their read state; it only
 * reads/writes the caller's own `EmailPreference` rows via the existing
 * route/action.
 */

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { BTN_PRIMARY, NOTE_DANGER, NOTE_SUCCESS } from "@/components/primitives/controls";
import { saveEmailPreferencesAction } from "@/app/notifications/actions";
import type { MutableEmailCategory } from "@/server/communications/contracts";

const SWITCHES: { id: MutableEmailCategory; label: string }[] = [
  { id: "TICKET_UPDATES", label: "Ticket replies and updates" },
  { id: "RESULT_NOTICES", label: "Result release notices" },
  { id: "SESSION_CHANGES", label: "Session change notices" },
  { id: "ENROLMENT_STATUS", label: "Enrolment status changes" },
];

const ALWAYS_EMAILED = [
  "Payment and enrolment confirmations",
  "Ticket received confirmations",
  "Certificates issued, revoked or reissued",
  "Session cancellations",
  "Account verification and password reset",
];

const INTRO =
  "Choose which updates we also send by email. In-product notifications always stay on.";
const SAVED_MESSAGE = "Preferences saved.";
const NOT_SAVED_MESSAGE = "Preferences not saved. Try again.";

function isMutableCategory(value: unknown): value is MutableEmailCategory {
  return typeof value === "string" && SWITCHES.some((item) => item.id === value);
}

export function EmailPreferencesPanel() {
  const [loaded, setLoaded] = useState(false);
  const [muted, setMuted] = useState<Set<MutableEmailCategory>>(new Set());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);

  // Fetch on mount, `.then`/`.catch` attached directly here (see
  // NotificationDrawer.tsx's identical shape for why).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/preferences", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ muted?: unknown }>)
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data.muted) ? data.muted.filter(isMutableCategory) : [];
        setMuted(new Set(list));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: MutableEmailCategory) {
    setResult(null);
    setMuted((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setResult(null);
    const response = await saveEmailPreferencesAction({ muted: Array.from(muted) });
    setSaving(false);
    setResult(response.ok ? "success" : "error");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
      <p className="pt-2 pb-4 text-sm text-muted-foreground">{INTRO}</p>

      <ul className="flex flex-col gap-1">
        {SWITCHES.map(({ id, label }) => {
          const checked = !muted.has(id);
          return (
            <li key={id}>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={label}
                disabled={!loaded}
                onClick={() => toggle(id)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
              >
                <span>{label}</span>
                <span
                  aria-hidden
                  className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ${
                    checked ? "justify-end bg-accent" : "justify-start bg-surface-2"
                  }`}
                >
                  <span className="size-5 rounded-full bg-surface" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="pt-6 pb-2 text-sm font-semibold text-foreground">Always emailed</p>
      <ul className="flex flex-col gap-1">
        {ALWAYS_EMAILED.map((label) => (
          <li
            key={label}
            className="flex min-h-11 items-center gap-3 px-2 text-sm text-muted-foreground"
          >
            <Lock aria-hidden className="size-4 shrink-0" />
            <span>{label}</span>
          </li>
        ))}
      </ul>

      {result === "success" && <p className={NOTE_SUCCESS}>{SAVED_MESSAGE}</p>}
      {result === "error" && <p className={NOTE_DANGER}>{NOT_SAVED_MESSAGE}</p>}

      <div className="pt-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !loaded}
          className={`${BTN_PRIMARY} w-full`}
        >
          {saving ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}
