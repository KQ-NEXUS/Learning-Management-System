import { VerifyTop } from "../verify/VerifyTop";

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
  return <VerifyTop />;
}
