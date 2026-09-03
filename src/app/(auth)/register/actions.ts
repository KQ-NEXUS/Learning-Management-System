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

  // G-03-3: the service call is wrapped in try/catch so a failure below it
  // (a dropped DB connection, or anything else the service does not itself
  // guard) returns the same generic-error state as an invalid submission,
  // rather than propagating a throw into a framework error page. Registration
  // may legitimately answer with an error; what it may not do is answer with
  // an error for one address and a success for another, which is what an
  // error page on the already-active branch would produce.
  let result;
  try {
    result = await registrationService.registerLearner({
      email,
      password,
      name,
      phone: null,
      acceptedTerms,
      acceptedPrivacy,
    });
  } catch {
    return { error: "Something went wrong. Nothing was saved — try again.", sent: false };
  }

  if (!result.ok) {
    return { error: "Something went wrong. Nothing was saved — try again.", sent: false };
  }

  return { error: null, sent: true, email };
}
