"use client";

import { useActionState } from "react";
import { AuthFooterLine, AuthTitle } from "../AuthPanel";
import { registerAction, type RegisterState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/identity";

const INITIAL: RegisterState = { error: null, sent: false };

const CHECKBOX = "mt-0.5 size-4 shrink-0 rounded-[4px] border-[1.5px] border-input-border";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, INITIAL);

  if (state.sent) {
    return (
      <AuthTitle
        title="Check your email"
        subtitle={`We've sent a verification link to ${state.email}. Click it to activate your account.`}
      />
    );
  }

  return (
    <>
      <AuthTitle title="Create account" subtitle="Register to enrol in Courses and Programmes." />

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
          <span className="font-semibold text-foreground">Full name</span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            required
            className="h-[38px] rounded-md border border-input-border bg-surface px-3 text-sm text-foreground"
          />
        </label>

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

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-semibold text-foreground">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            className="h-[38px] rounded-md border border-input-border bg-surface px-3 text-sm text-foreground"
          />
          <span className="text-[11px] text-muted-foreground">At least 10 characters.</span>
        </label>

        <label className="flex items-start gap-2.5 text-sm text-foreground">
          <input name="acceptTerms" type="checkbox" required className={CHECKBOX} />
          <span>I agree to the terms of service.</span>
        </label>

        <label className="flex items-start gap-2.5 text-sm text-foreground">
          <input name="acceptPrivacy" type="checkbox" required className={CHECKBOX} />
          <span>I agree to the privacy notice.</span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <AuthFooterLine text="Already have an account?" href="/signin" linkLabel="Sign in" />
    </>
  );
}
