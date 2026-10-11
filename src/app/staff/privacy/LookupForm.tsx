"use client";

import { useEffect, useId, useRef } from "react";
import { BTN_PRIMARY, CONTROL, FIELD, NOTE_DANGER } from "@/components/primitives/controls";

/**
 * The one-field learner lookup (UI-SPEC S2).
 *
 * A native GET form: submitting it reloads the page with `?q=`, the server looks
 * the value up and either redirects to the learner's record (so the search value
 * never stays in the address bar) or renders this form again with the value
 * refilled and one message. A client component only so focus can move to the
 * message when there is one (S7 errors row). It holds no data and decides
 * nothing: the message text comes from the page.
 */
export function LookupForm({ value, message }: { value: string; message: string | null }) {
  const inputId = useId();
  const helpId = useId();
  const alertId = useId();
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message) alertRef.current?.focus();
  }, [message]);

  return (
    <form method="get" action="/staff/privacy" className="flex max-w-[760px] flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className={`${FIELD} w-full max-w-md`}>
          <label htmlFor={inputId}>Learner email or learner number</label>
          <input
            id={inputId}
            key={value}
            type="text"
            name="q"
            defaultValue={value}
            autoComplete="off"
            spellCheck={false}
            maxLength={254}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? `${helpId} ${alertId}` : helpId}
            className={`${CONTROL} w-full`}
          />
        </div>
        <button type="submit" className={BTN_PRIMARY}>
          Find learner
        </button>
      </div>
      <p id={helpId} className="text-[13px] text-muted-foreground">
        Enter the exact email address or learner number. Partial matches are not shown.
      </p>
      {message && (
        <p ref={alertRef} id={alertId} role="alert" tabIndex={-1} className={NOTE_DANGER}>
          {message}
        </p>
      )}
    </form>
  );
}
