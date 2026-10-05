"use server";

import { registrationService } from "@/server/services/registration-service";
import { MIN_PASSWORD_LENGTH } from "@/lib/identity";
import { LEARNER_REFUSAL_MESSAGE } from "@/server/licence/policy";

export type RegisterState = {
  error: string | null;
  sent: boolean;
  email?: string;
  /**
   * What the visitor typed, echoed back on a refusal so the form can show it
   * again: React resets a form to its default values once its action settles.
   * Never the password.
   */
  values?: { name: string; email: string };
  /** Counts refusals, so the form remounts its fields onto the echoed values. */
  attempt?: number;
};

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");
  const acceptedTerms = formData.get("acceptTerms") === "on";
  const acceptedPrivacy = formData.get("acceptPrivacy") === "on";
  const refuse = (error: string): RegisterState => ({
    error,
    sent: false,
    values: { name, email },
    attempt: (_prev.attempt ?? 0) + 1,
  });

  if (!email || !password || !name) {
    return refuse("Enter your name, email address, and a password.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return refuse("Use a password of at least 10 characters.");
  }

  if (!acceptedTerms || !acceptedPrivacy) {
    return refuse("Accept the terms of service and the privacy notice to continue.");
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
    return refuse("Something went wrong. Nothing was saved — try again.");
  }

  // OQ8 / A12 — the one neutral learner sentence; no licence wording.
  if (!result.ok && result.reason === "UNAVAILABLE") {
    return refuse(LEARNER_REFUSAL_MESSAGE);
  }

  if (!result.ok) {
    return refuse("Something went wrong. Nothing was saved — try again.");
  }

  return { error: null, sent: true, email };
}
