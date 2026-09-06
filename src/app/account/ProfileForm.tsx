"use client";

import { useActionState } from "react";
import {
  updateProfileAction,
  requestEmailChangeAction,
  setMarketingPreferenceAction,
  type UpdateProfileState,
  type RequestEmailChangeState,
  type SetMarketingPreferenceState,
} from "./actions";

const UPDATE_INITIAL: UpdateProfileState = { error: null, saved: false, saveCount: 0, savedProfile: null };
const EMAIL_CHANGE_INITIAL: RequestEmailChangeState = { error: null, requested: false };

const INPUT =
  "h-[38px] rounded-md border border-input-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-2 focus:outline-offset-2 focus:outline-accent";
const LABEL = "text-sm font-semibold text-foreground";
const BTN_PRIMARY =
  "rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const CARD = "flex flex-col rounded-xl border border-border bg-surface shadow-card";
const CARD_HEADER = "flex flex-col gap-0.5 border-b border-border px-5 py-4";
const CARD_TITLE = "text-sm font-semibold text-foreground";
const CARD_SUBCOPY = "text-[11px] text-muted-foreground";
const CARD_BODY = "flex flex-col gap-4 px-5 py-5";
const ERROR_BANNER =
  "rounded-md border border-danger/30 bg-danger-surface px-3 py-2.5 text-sm text-danger";

export function ProfileForm({
  name,
  phone,
  email,
  pendingEmail,
  marketingOptIn,
}: {
  name: string;
  phone: string | null;
  email: string;
  pendingEmail: string | null;
  marketingOptIn: boolean;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-5 sm:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-5">
        <NameAndPhoneSection name={name} phone={phone} />
        <EmailChangeSection email={email} pendingEmail={pendingEmail} />
      </div>
      <div className="flex flex-col gap-5">
        <MarketingPreferenceSection initialMarketingOptIn={marketingOptIn} />
      </div>
    </div>
  );
}

function NameAndPhoneSection({ name, phone }: { name: string; phone: string | null }) {
  const [state, action, pending] = useActionState(updateProfileAction, UPDATE_INITIAL);

  // G-03-6b — branch on the echoed profile being present rather than a
  // null-coalescing chain: a saved phone of null must render as an empty
  // field, not silently fall back to the stale server prop, which is
  // exactly what `savedProfile?.phone ?? phone` would do.
  const displayName = state.savedProfile !== null ? state.savedProfile.name : name;
  const displayPhone = state.savedProfile !== null ? state.savedProfile.phone : phone;

  return (
    <form action={action} className={CARD}>
      <div className={CARD_HEADER}>
        <h2 className={CARD_TITLE}>Your details</h2>
      </div>
      <div className={CARD_BODY}>
        {state.error && (
          <p role="alert" className={ERROR_BANNER}>
            {state.error}
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Full name</span>
          <input
            // React 19 resets an uncontrolled form after a form action
            // completes, restoring `defaultValue` — an already-mounted input
            // does not follow a changed `defaultValue` prop, so
            // revalidatePath alone leaves this field showing the pre-save
            // value (exactly what UAT reported). Keying off the save counter
            // forces a remount on every successful save, so the reset lands
            // on the value that was actually saved.
            key={`name-${state.saveCount}`}
            name="name"
            type="text"
            autoComplete="name"
            required
            defaultValue={displayName}
            className={INPUT}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Phone</span>
          <input
            key={`phone-${state.saveCount}`}
            name="phone"
            type="tel"
            autoComplete="tel"
            defaultValue={displayPhone ?? ""}
            className={INPUT}
          />
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Saving…" : "Save changes"}
          </button>
          {state.saved && <span className="text-sm text-muted-foreground">Saved.</span>}
        </div>
      </div>
    </form>
  );
}

function EmailChangeSection({ email, pendingEmail }: { email: string; pendingEmail: string | null }) {
  const [state, action, pending] = useActionState(requestEmailChangeAction, EMAIL_CHANGE_INITIAL);

  return (
    <form action={action} className={CARD}>
      <div className={CARD_HEADER}>
        <h2 className={CARD_TITLE}>Email address</h2>
        <p className={CARD_SUBCOPY}>
          Changing this needs your current password, then a confirmation from the new address.
        </p>
      </div>
      <div className={CARD_BODY}>
        {state.error && (
          <p role="alert" className={ERROR_BANNER}>
            {state.error}
          </p>
        )}

        {state.requested ? (
          <p className="text-sm text-muted-foreground">
            Confirm your new email address — we&apos;ve sent a verification link to {state.newEmail}.
            Your current email stays active until you confirm it.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Email address</span>
              <input
                name="newEmail"
                type="email"
                autoComplete="email"
                required
                defaultValue={pendingEmail ?? email}
                className={INPUT}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Current password</span>
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                className={INPUT}
              />
              <span className="text-[11px] text-muted-foreground">
                Enter your current password to change your email address.
              </span>
            </label>

            <button type="submit" disabled={pending} className={`${BTN_PRIMARY} self-start`}>
              {pending ? "Saving…" : "Save changes"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

function MarketingPreferenceSection({ initialMarketingOptIn }: { initialMarketingOptIn: boolean }) {
  const [state, action, pending] = useActionState<SetMarketingPreferenceState, FormData>(
    setMarketingPreferenceAction,
    { error: null, accepted: initialMarketingOptIn },
  );

  // Fully controlled by the server-confirmed `state.accepted` — no separate
  // local/optimistic state. A failed save's returned `accepted` is the
  // reverted (pre-toggle) value, so the checkbox naturally snaps back to it
  // on the next render with no extra revert logic needed.
  return (
    <form
      action={action}
      className={CARD}
      onChange={(event) => event.currentTarget.requestSubmit()}
    >
      <div className="flex flex-col gap-2 px-5 py-5">
        <h2 className={CARD_TITLE}>Marketing emails</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Occasional news about new programmes. Never affects your enrolment.
        </p>

        {state.error && (
          <p role="alert" className={ERROR_BANNER}>
            {state.error}
          </p>
        )}

        <label className="flex items-center gap-2.5 pt-1">
          <span className="relative inline-flex h-[22px] w-[38px] shrink-0 items-center">
            <input
              name="marketingOptIn"
              type="checkbox"
              checked={state.accepted}
              onChange={() => {}}
              disabled={pending}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
            />
            <span
              aria-hidden
              className="relative left-0.5 size-[18px] translate-x-0 rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,0.15)] transition-transform peer-checked:translate-x-[16px]"
            />
          </span>
          <span className="text-sm text-muted-foreground">
            {state.accepted ? "On" : "Off"}
          </span>
        </label>
        <p className="text-[11px] text-muted-foreground">
          Transactional email — such as verification, password reset, and order or enrolment notices —
          is always sent regardless of this setting.
        </p>
      </div>
    </form>
  );
}
