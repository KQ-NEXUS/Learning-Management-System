"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction, type RegisterState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/identity";

const INITIAL: RegisterState = { error: null, sent: false };

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, INITIAL);

  if (state.sent) {
    return (
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-zinc-600">
          We&apos;ve sent a verification link to {state.email}. Click it to activate your account.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Create account</h1>
        <p className="text-sm text-zinc-600">Register to enrol in Courses and Programmes.</p>
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
          <span className="font-medium">Full name</span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            required
            className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
          />
        </label>

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

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            className="border border-zinc-300 px-3 py-2 focus:outline-2 focus:outline-offset-2"
          />
          <span className="text-xs text-zinc-600">At least 10 characters.</span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input name="acceptTerms" type="checkbox" required className="mt-1" />
          <span>I agree to the terms of service.</span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input name="acceptPrivacy" type="checkbox" required className="mt-1" />
          <span>I agree to the privacy notice.</span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-sm text-zinc-600">
        Already have an account?{" "}
        <Link href="/signin" className="text-accent underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </>
  );
}
