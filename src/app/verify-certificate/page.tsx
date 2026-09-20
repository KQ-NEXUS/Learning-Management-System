import { VerifyReferenceForm } from "../verify/VerifyReferenceForm";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";

/**
 * Public certificate reference-entry page (CRD-04, UAT test 13).
 *
 * `/verify` is owned by IAM-02 email verification (`(auth)/verify/page.tsx`,
 * linked from already-dispatched emails), so an employer holding only a
 * reference string (not a URL) starts here instead. This page performs no
 * lookup and reads no search params: the form only navigates to the single
 * lookup route, `/verify/[verificationRef]`.
 *
 * No `dynamic` / `revalidate` / `fetchCache` export and no `'use cache'`
 * (Pitfall 6) — there is nothing here to cache or invalidate.
 */
export const metadata = { title: "Verify a certificate" };

export default function VerifyCertificateEntryPage() {
  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader
        size="hero"
        title="Verify a certificate"
        subtitle="Enter the verification reference from a certificate to check whether it's valid."
      />
      <VerifyReferenceForm />
    </div>
  );
}
