import Link from "next/link";
import { Check } from "lucide-react";
import { AuthIconChip, AuthTitle } from "../AuthPanel";
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

  return result.ok ? (
    <>
      <AuthIconChip icon={Check} tone="success" />
      <AuthTitle
        title="Email address updated"
        subtitle="You now sign in with your new email address."
      />
      <Link href="/signin" className="text-sm font-semibold text-accent underline underline-offset-2">
        Continue to sign in
      </Link>
    </>
  ) : (
    <>
      <AuthTitle
        title="This link is no longer valid"
        subtitle="Links expire after 24 hours or can only be used once. Start the change again from your account page."
      />
      <Link href="/account" className="text-sm font-semibold text-accent underline underline-offset-2">
        Go to your account
      </Link>
    </>
  );
}
