import { AuthTitle } from "../AuthPanel";
import { ResendVerificationForm } from "../verify/ResendVerificationForm";
import { forgotPasswordAction } from "../forgot-password/actions";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const token = params.token;
  const hasToken = typeof token === "string" && token.length > 0;

  return hasToken ? (
    <>
      <AuthTitle
        title="Choose a new password"
        subtitle="Your new password takes effect immediately."
      />
      <ResetPasswordForm token={token} />
    </>
  ) : (
    <>
      <AuthTitle
        title="This link is no longer valid"
        subtitle="Links expire after 24 hours or can only be used once. Enter your email below to get a new one."
      />
      <ResendVerificationForm
        label="Send new reset link"
        action={forgotPasswordAction}
        successMessage="If an account exists for that email, we've sent a link to reset your password."
      />
    </>
  );
}
