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

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      {hasToken ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
            <p className="text-sm text-zinc-600">Your new password takes effect immediately.</p>
          </div>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">This link is no longer valid</h1>
            <p className="text-sm text-zinc-600">
              Links expire after 24 hours or can only be used once. Enter your email below to get a
              new one.
            </p>
          </div>
          <ResendVerificationForm
            label="Send new reset link"
            action={forgotPasswordAction}
            successMessage="If an account exists for that email, we've sent a link to reset your password."
          />
        </>
      )}
    </main>
  );
}
