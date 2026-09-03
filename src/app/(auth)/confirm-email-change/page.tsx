import Link from "next/link";
import { profileService } from "@/server/services/profile-service";

export const metadata = { title: "Confirm your new email address" };

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const token = params.token;

  // Absent, empty, or array-valued: fall straight through to the invalid
  // state without calling the service.
  const result =
    typeof token === "string" && token.length > 0
      ? await profileService.confirmEmailChange(token)
      : ({ ok: false } as const);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      {result.ok ? (
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Email address updated</h1>
          <p className="text-sm text-zinc-600">
            You now sign in with your new email address.
          </p>
          <Link href="/signin" className="text-accent underline underline-offset-2">
            Continue to sign in
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">This link is no longer valid</h1>
          <p className="text-sm text-zinc-600">
            Links expire after 24 hours or can only be used once. Start the change again from your
            account page.
          </p>
          <Link href="/account" className="text-accent underline underline-offset-2">
            Go to your account
          </Link>
        </div>
      )}
    </main>
  );
}
