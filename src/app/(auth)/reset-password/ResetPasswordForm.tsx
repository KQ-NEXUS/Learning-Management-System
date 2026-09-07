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
          className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-foreground">New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="h-[38px] rounded-md border border-input-border bg-surface px-4 text-sm text-foreground"
        />
        <span className="text-[11px] text-muted-foreground">At least 10 characters.</span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Update password"}
      </button>
    </form>
  );
}
