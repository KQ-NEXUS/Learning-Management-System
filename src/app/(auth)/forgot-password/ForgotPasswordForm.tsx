"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type ForgotPasswordState } from "./actions";

const INITIAL: ForgotPasswordState = { error: null, sent: false };

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, INITIAL);

  if (state.sent) {
    return (
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-zinc-600">
          If an account exists for that email, we&apos;ve sent a link to reset your password.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-sm text-zinc-600">
          Enter your email and we&apos;ll send you a link to reset it.
        </p>
      </div>

      <form action={action} className="flex w-full max-w-sm flex-col gap-4">
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
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </>
  );
}
