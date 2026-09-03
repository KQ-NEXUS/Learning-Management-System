"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ResetPasswordState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/identity";

const INITIAL: ResetPasswordState = { error: null };

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, INITIAL);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New password</span>
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

      <button
        type="submit"
        disabled={pending}
        className="bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Update password"}
      </button>
    </form>
  );
}
