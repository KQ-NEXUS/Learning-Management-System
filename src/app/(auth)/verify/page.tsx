import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { AuthIconChip, AuthTitle } from "../AuthPanel";
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

  return result.ok ? (
    <>
      <AuthTitle title="Email verified" subtitle="You can now sign in." />
      <Link href="/signin" className="text-sm font-semibold text-accent underline underline-offset-2">
        Continue to sign in
      </Link>
    </>
  ) : (
    <>
      <AuthIconChip icon={AlertCircle} tone="danger" />
      <AuthTitle
        title="This link is no longer valid"
        subtitle="Links expire after 24 hours or can only be used once. Enter your email below to get a new one."
      />
      <ResendVerificationForm />
    </>
  );
}
