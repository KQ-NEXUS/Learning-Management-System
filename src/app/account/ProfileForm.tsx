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
    <div className="flex w-full max-w-sm flex-col gap-8">
      <NameAndPhoneSection name={name} phone={phone} />
      <EmailChangeSection email={email} pendingEmail={pendingEmail} />
      <MarketingPreferenceSection initialMarketingOptIn={marketingOptIn} />
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
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold tracking-tight">Profile</h2>

      {state.error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Full name</span>
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
          className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          key={`phone-${state.saveCount}`}
          name="phone"
          type="tel"
          autoComplete="tel"
          defaultValue={displayPhone ?? ""}
          className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        {state.saved && <span className="text-sm text-zinc-600">Saved.</span>}
      </div>
    </form>
  );
}

function EmailChangeSection({ email, pendingEmail }: { email: string; pendingEmail: string | null }) {
  const [state, action, pending] = useActionState(requestEmailChangeAction, EMAIL_CHANGE_INITIAL);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold tracking-tight">Email address</h2>

      {state.error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      {state.requested ? (
        <p className="text-sm text-zinc-600">
          Confirm your new email address — we&apos;ve sent a verification link to {state.newEmail}.
          Your current email stays active until you confirm it.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email address</span>
            <input
              name="newEmail"
              type="email"
              autoComplete="email"
              required
              defaultValue={pendingEmail ?? email}
              className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Current password</span>
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
            />
            <span className="text-xs text-zinc-600">
              Enter your current password to change your email address.
            </span>
          </label>

          <button
            type="submit"
            disabled={pending}
            className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        </>
      )}
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
      className="flex flex-col gap-2"
      onChange={(event) => event.currentTarget.requestSubmit()}
    >
      <h2 className="text-sm font-semibold tracking-tight">Communication preferences</h2>

      {state.error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input
          name="marketingOptIn"
          type="checkbox"
          checked={state.accepted}
          onChange={() => {}}
          disabled={pending}
          className="mt-1"
        />
        <span>Send me marketing emails about new Courses and Programmes.</span>
      </label>
      <p className="text-xs text-zinc-600">
        Transactional email — such as verification, password reset, and order or enrolment notices —
        is always sent regardless of this setting.
      </p>
    </form>
  );
}
