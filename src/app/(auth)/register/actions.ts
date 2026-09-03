"use server";

import { registrationService } from "@/server/services/registration-service";
import { MIN_PASSWORD_LENGTH } from "@/lib/identity";

export type RegisterState = { error: string | null; sent: boolean; email?: string };

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  const acceptedTerms = formData.get("acceptTerms") === "on";
  const acceptedPrivacy = formData.get("acceptPrivacy") === "on";

  if (!email || !password || !name) {
    return { error: "Enter your name, email address, and a password.", sent: false };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: "Use a password of at least 10 characters.", sent: false };
  }

  if (!acceptedTerms || !acceptedPrivacy) {
    return { error: "Accept the terms of service and the privacy notice to continue.", sent: false };
  }

  const result = await registrationService.registerLearner({
    email,
    password,
    name,
    phone: null,
    acceptedTerms,
    acceptedPrivacy,
  });

  if (!result.ok) {
    return { error: "Something went wrong. Nothing was saved — try again.", sent: false };
  }

  return { error: null, sent: true, email };
}
