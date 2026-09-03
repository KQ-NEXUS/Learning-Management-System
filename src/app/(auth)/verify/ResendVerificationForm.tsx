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
    return <p className="text-sm text-zinc-600">{successMessage}</p>;
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      {state.error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Sending…" : label}
      </button>
    </form>
  );
}
