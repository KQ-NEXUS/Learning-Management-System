"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/primitives/ConfirmModal";
import { CONTROL, FIELD, NOTE_SUCCESS, NOTE_WARNING } from "@/components/primitives/controls";
import { LagosTime } from "@/components/time/LagosTime";
import type { ANONYMISE_POLICY } from "@/server/services/privacy-anonymise-service";
import { anonymiseLearnerAction } from "../actions";

/**
 * The "Anonymise account" danger zone of a learner's privacy record (plan 15-22,
 * UI-SPEC S3; T-15-22-03).
 *
 * Making the irreversible action hard to aim at the wrong person takes three
 * steps: the staff member types the learner's email address (a guard against the
 * wrong record, checked ignoring case and surrounding spaces), then confirms in
 * a danger ConfirmModal with a reason of at least 20 characters. None of that is
 * a security control: `anonymiseLearnerAction` re-checks the permission, the
 * target and the reason on the server.
 *
 * "What changes" and "What is kept" render `ANONYMISE_POLICY`, the one constant
 * the anonymise service is also pinned to, so this screen cannot drift from what
 * the service does and a later owner decision edits one constant, not the page.
 * The server page passes the constant in as `policy`: the service module reaches
 * the database, so it must not be imported into this client bundle (only its
 * type is, and that import is erased).
 *
 * `anonymised` comes from the server. After a successful call the page
 * re-renders from the server (new status, the "anonymised on … by …" line); this
 * component stays mounted across that refresh so the success note, and focus on
 * it, survive until the next navigation. The ConfirmModal is `licenceEffect`
 * write (the default), so it is disabled with a visible reason in restricted mode.
 */

const MISMATCH = "This does not match the learner's email address.";
const DISABLED_REASON = "Type the learner's email address above to continue.";

function sameEmail(typed: string, actual: string): boolean {
  const left = typed.trim().toLowerCase();
  return left.length > 0 && left === actual.trim().toLowerCase();
}

export function AnonymiseSection({
  userId,
  learnerName,
  learnerEmail,
  policy,
  anonymised,
  anonymisedAt,
  anonymisedByName,
}: {
  userId: string;
  learnerName: string;
  learnerEmail: string;
  /** The anonymise service's `ANONYMISE_POLICY`, passed in by the server page. */
  policy: typeof ANONYMISE_POLICY;
  anonymised: boolean;
  /** ISO 8601, set once the account has been anonymised. */
  anonymisedAt: string | null;
  anonymisedByName: string | null;
}) {
  const router = useRouter();
  const inputId = useId();
  const mismatchId = useId();
  const reasonId = useId();
  const noteRef = useRef<HTMLParagraphElement>(null);
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startAnonymise] = useTransition();

  const matches = sameEmail(typed, learnerEmail);
  const showMismatch = touched && !matches;

  useEffect(() => {
    if (done) noteRef.current?.focus();
  }, [done]);

  function confirm(reason: string) {
    startAnonymise(async () => {
      try {
        const result = await anonymiseLearnerAction({ userId, reason });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setError(null);
        setOpen(false);
        setDone(true);
        router.refresh();
      } catch (caught) {
        // Framework control flow (a redirect or not-found thrown by the action) must pass through.
        unstable_rethrow(caught);
        setError("The account was not changed. Try again; if it fails again, contact an administrator.");
      }
    });
  }

  function tryOpen() {
    setTouched(true);
    if (!sameEmail(typed, learnerEmail)) return;
    setError(null);
    setOpen(true);
  }

  // After the outcome: the success note (until navigation) and the server's record of what happened.
  if (anonymised || done) {
    return (
      <section aria-label="Anonymise account" className="flex flex-col gap-4 border-t border-foreground pt-8">
        {done && (
          <p ref={noteRef} role="status" tabIndex={-1} className={NOTE_SUCCESS}>
            Account anonymised. The learner has been signed out everywhere and can no longer sign in.
          </p>
        )}
        {anonymised && (
          <p className="text-sm text-foreground">
            This account was anonymised on <LagosTime value={anonymisedAt} className="font-mono" /> by{" "}
            {anonymisedByName ?? "a staff member"}. There is no personal data left to export or change.
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="anonymise-account-heading" className="flex flex-col gap-4 border-t-2 border-danger pt-8">
      <h2
        id="anonymise-account-heading"
        className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground"
      >
        Anonymise account
      </h2>
      <p className="text-sm text-foreground">
        Anonymising replaces this learner&apos;s name and email address, removes their phone number and password,
        signs them out everywhere and deactivates the account. This cannot be undone.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-foreground">What changes</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
            {policy.changes.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {policy.removes.map((item) => (
              <li key={item}>Removed: {item}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold text-foreground">What is kept</h3>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
            {policy.keeps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className={NOTE_WARNING}>Permanent deletion is not available until the retention policy is approved.</p>
      <p className="text-sm text-foreground">
        If the learner asked for a copy of their data, prepare and download the export before you anonymise.
      </p>

      <div className={`${FIELD} w-full max-w-md`}>
        <label htmlFor={inputId}>Type the learner&apos;s email address to confirm</label>
        <input
          id={inputId}
          type="text"
          value={typed}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={showMismatch ? true : undefined}
          aria-describedby={showMismatch ? mismatchId : undefined}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            tryOpen();
          }}
          className={`${CONTROL} w-full`}
        />
        {showMismatch && (
          <p id={mismatchId} role="alert" className="text-sm font-normal text-danger">
            {MISMATCH}
          </p>
        )}
      </div>

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          disabled={!matches}
          aria-describedby={matches ? undefined : reasonId}
          onClick={tryOpen}
          className="inline-flex min-h-[46px] items-center justify-center rounded-md bg-danger px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          Anonymise account
        </button>
        {!matches && (
          <p id={reasonId} className="text-[13px] text-muted-foreground">
            {DISABLED_REASON}
          </p>
        )}
      </div>

      <ConfirmModal
        open={open}
        eyebrow="Cannot be undone"
        tone="danger"
        title={`Anonymise ${learnerName}'s account?`}
        description="Their personal details are replaced and they are signed out everywhere. The records listed under What is kept stay. This cannot be undone."
        reasonLabel="Reason (for example, the learner's request reference)"
        minReasonLength={20}
        confirmLabel="Anonymise account"
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
    </section>
  );
}
