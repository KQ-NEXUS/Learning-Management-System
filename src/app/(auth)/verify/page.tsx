import Link from "next/link";
import { verificationService } from "@/server/services/verification-service";
import { ResendVerificationForm } from "./ResendVerificationForm";

export const metadata = { title: "Verify your email" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const token = params.token;

  // Absent, empty, or array-valued: fall straight through to the invalid
  // state without calling the service. There is no error boundary in this
  // app yet, so an unhandled throw here would surface a framework error page.
  const result =
    typeof token === "string" && token.length > 0
      ? await verificationService.verifyEmail(token)
      : ({ ok: false } as const);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      {result.ok ? (
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Email verified</h1>
          <p className="text-sm text-zinc-600">You can now sign in.</p>
          <Link href="/signin" className="text-accent underline underline-offset-2">
            Continue to sign in
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">This link is no longer valid</h1>
            <p className="text-sm text-zinc-600">
              Links expire after 24 hours or can only be used once. Enter your email below to get a
              new one.
            </p>
          </div>
          <ResendVerificationForm />
        </>
      )}
    </main>
  );
}
