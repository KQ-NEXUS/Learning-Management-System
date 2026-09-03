"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type SignInState } from "./actions";

const INITIAL: SignInState = { error: null };

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, INITIAL);

  return (
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
          autoComplete="username"
          required
          className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <Link href="/forgot-password" className="text-accent underline underline-offset-2">
        Forgot your password?
      </Link>
      <Link href="/register" className="text-accent underline underline-offset-2">
        New here? Create an account
      </Link>
    </form>
  );
}
