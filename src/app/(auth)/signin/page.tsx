import { AuthTitle } from "../AuthPanel";
import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const showResetConfirmation = params.reset === "1";

  return (
    <>
      <AuthTitle
        title="Sign in"
        subtitle="Staff and learner access to the training portal."
      />
      {showResetConfirmation && (
        <p className="text-sm text-muted-foreground">
          Password updated. Sign in with your new password.
        </p>
      )}
      <SignInForm />
    </>
  );
}
