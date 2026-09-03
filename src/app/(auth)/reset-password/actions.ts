"use server";

import { redirect } from "next/navigation";
import { passwordResetService } from "@/server/services/password-reset-service";
import { MIN_PASSWORD_LENGTH } from "@/lib/identity";

export type ResetPasswordState = { error: string | null };

export async function resetPasswordAction(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("password") ?? "");

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: "Use a password of at least 10 characters." };
  }

  const result = await passwordResetService.resetPassword({ token, newPassword });

  if (!result.ok) {
    // Deliberately generic — the difference between an expired token and an
    // already-used one is exactly what must not be disclosed.
    return { error: "Something went wrong. Nothing was saved — try again." };
  }

  redirect("/signin?reset=1");
}
