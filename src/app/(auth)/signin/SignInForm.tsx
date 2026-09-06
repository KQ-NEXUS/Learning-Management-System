"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthFooterLine } from "../AuthPanel";
import { signInAction, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL);

  return (
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
          autoComplete="username"
          required
          className="h-[38px] rounded-md border border-input-border bg-surface px-3 text-sm text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="flex items-baseline justify-between">
          <span className="font-semibold text-foreground">Password</span>
          <Link href="/forgot-password" className="text-[11px] text-accent">
            Forgot?
          </Link>
        </span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-[38px] rounded-md border border-input-border bg-surface px-3 text-sm text-foreground"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <AuthFooterLine text="New here?" href="/register" linkLabel="Create an account" />
    </form>
  );
}
