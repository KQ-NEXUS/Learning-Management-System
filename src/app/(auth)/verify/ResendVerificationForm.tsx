"use client";

import { useActionState } from "react";
import { resendVerificationAction, type ResendVerificationState } from "./actions";

const INITIAL: ResendVerificationState = { error: null, sent: false };

type ResendAction = (
  prev: ResendVerificationState,
  formData: FormData,
) => Promise<ResendVerificationState>;

export function ResendVerificationForm({
  label = "Resend verification email",
  action = resendVerificationAction,
  successMessage = "If an account exists for that email, we've sent a link.",
}: {
  label?: string;
  action?: ResendAction;
  successMessage?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  if (state.sent) {
    return <p className="text-sm text-muted-foreground">{successMessage}</p>;
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-foreground">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-12 w-full rounded-md border border-input-border bg-surface px-4 text-sm text-foreground"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-md bg-accent px-4 text-base font-semibold text-accent-contrast hover:bg-accent-deep disabled:opacity-50"
      >
        {pending ? "Sending…" : label}
      </button>
    </form>
  );
}
