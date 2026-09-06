"use client";

import { useActionState } from "react";
import { AuthTitle } from "../AuthPanel";
import { forgotPasswordAction, type ForgotPasswordState } from "./actions";

const INITIAL: ForgotPasswordState = { error: null, sent: false };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, INITIAL);

  if (state.sent) {
    return (
      <AuthTitle
        title="Check your email"
        subtitle="If an account exists for that email, we've sent a link to reset your password."
      />
    );
  }

  return (
    <>
      <AuthTitle
        title="Forgot your password?"
        subtitle="Enter your email and we'll send you a link to reset it."
      />

      <form action={action} className="flex w-full max-w-sm flex-col gap-4">
        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
          >
            {state.error}
          </p>
        )}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Email address</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-[38px] rounded-md border border-input-border bg-surface px-3 text-sm text-foreground"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </>
  );
}
