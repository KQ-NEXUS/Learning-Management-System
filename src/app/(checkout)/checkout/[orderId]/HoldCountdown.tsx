"use client";

import { useEffect, useState } from "react";

/**
 * Display-only countdown for the seat hold (D-11). This component is a UI
 * clock, not authority — it never issues a redirect, a client-side
 * navigation, or a form submission of any kind, and it never makes the Pay
 * control inert. The server re-checks the real hold expiry on every page
 * render and again inside the pay action itself (checkout-service.ts);
 * reaching zero here means only that the NEXT server check will agree with
 * what this component already shows, not that anything expired at this
 * instant. A client clock a user can pause or change must never be able to
 * buy — or cost — a single extra second of hold time.
 *
 * The remainder is recomputed against the current time on every tick rather
 * than decremented from a stored counter, so a backgrounded tab that
 * throttles timers resumes showing the truth instead of a drifted number.
 */

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function HoldCountdown({ holdExpiresAt }: { holdExpiresAt: string }) {
  const expiry = new Date(holdExpiresAt).getTime();
  const [remainingMs, setRemainingMs] = useState(() => Math.max(expiry - Date.now(), 0));

  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(expiry - Date.now(), 0));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiry]);

  const totalSeconds = Math.floor(remainingMs / 1000);
  // UI-SPEC 5/7.2 — colour escalates on threshold crossing; the type size
  // never changes (UI-SPEC 4 is explicit urgency is carried by colour alone).
  const valueColorClass =
    totalSeconds < 60 ? "text-danger" : totalSeconds < 300 ? "text-warning" : "text-foreground";

  return (
    <p className="flex items-baseline gap-1 text-sm">
      <span className="text-muted-foreground">Seat held for</span>
      <span className={`font-mono font-semibold tabular-nums ${valueColorClass}`}>
        {formatRemaining(remainingMs)}
      </span>
    </p>
  );
}
