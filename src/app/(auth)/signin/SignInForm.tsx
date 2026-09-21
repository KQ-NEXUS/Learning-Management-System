"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PasswordInput } from "@/components/primitives/PasswordInput";
import { AuthFooterLine } from "../AuthPanel";
import { signInAction, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={action} className="flex w-full flex-col gap-5">
      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-2 text-sm">
        <span className="font-semibold text-foreground">Email address</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-12 w-full rounded-md border border-input-border bg-surface px-4 text-sm text-foreground"
        />
      </label>

      <label className="flex flex-col gap-2 text-sm">
        <span className="flex items-baseline justify-between">
          <span className="font-semibold text-foreground">Password</span>
          <Link href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </span>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          required
          className="h-12 w-full rounded-md border border-input-border bg-surface px-4 text-sm text-foreground"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-md bg-accent px-4 text-base font-semibold text-accent-contrast hover:bg-accent-deep disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <AuthFooterLine text="New here?" href="/register" linkLabel="Create an account" />
    </form>
  );
}
