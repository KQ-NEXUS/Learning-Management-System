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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-zinc-600">
          Staff and learner access to the training portal.
        </p>
      </div>
      {showResetConfirmation && (
        <p className="text-sm text-zinc-600">Password updated. Sign in with your new password.</p>
      )}
      <SignInForm />
    </main>
  );
}
