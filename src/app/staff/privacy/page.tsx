import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { SessionEnded } from "@/components/shell/SessionEnded";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { privacyReadService } from "@/server/services/privacy-read-service";
import { LookupForm } from "./LookupForm";
import { PrivacyDenied } from "./PrivacyDenied";

/**
 * `/staff/privacy` — find one learner for the privacy tools (plan 15-22; D-12, NFR-11).
 *
 * Exact email address or exact learner number only. A match redirects to the
 * learner's record, so the search value never stays in the address bar; a staff
 * account, an unknown value and malformed input all give the same single
 * message, so the lookup cannot be used to learn which accounts exist or who is
 * staff. The read service is gated by `privacy.manage`; `can()` below only
 * decides whether to draw the form or the denied panel (a courtesy, not the
 * gate: the service refuses a caller without the permission on its own).
 */

export const metadata = { title: "Learner privacy" };
export const dynamic = "force-dynamic";

const SUBTITLE = "Export one learner's data or anonymise their account. Every action is recorded in the audit log.";
const EMPTY_MESSAGE = "Enter an email address or learner number.";
const NO_MATCH_MESSAGE = "No learner matches that email address or learner number. Check it and try again.";

export default async function LearnerPrivacyLookupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await can("privacy.manage", {}))) return <PrivacyDenied />;

  const params = await searchParams;
  const submitted = params.q;
  // A repeated ?q=a&q=b is malformed input, not a search.
  const value = typeof submitted === "string" ? submitted : Array.isArray(submitted) ? submitted.join(" ") : "";

  let message: string | null = null;
  let matchedUserId: string | null = null;
  if (submitted !== undefined) {
    if (value.trim().length === 0) {
      message = EMPTY_MESSAGE;
    } else if (Array.isArray(submitted)) {
      message = NO_MATCH_MESSAGE;
    } else {
      try {
        const match = await privacyReadService.findLearnerForPrivacy({ query: value });
        if (match) matchedUserId = match.userId;
        else message = NO_MATCH_MESSAGE;
      } catch (error) {
        if (error instanceof AuthenticationError) return <SessionEnded />;
        if (error instanceof AuthorizationError) return <PrivacyDenied />;
        throw error;
      }
    }
  }

  // Outside the try block: redirect() works by throwing.
  if (matchedUserId) redirect(`/staff/privacy/${encodeURIComponent(matchedUserId)}`);

  return (
    <div className="flex flex-col">
      <PageHeader title="Learner privacy" subtitle={SUBTITLE} />
      <div className="mt-4">
        <LookupForm value={value} message={message} />
      </div>
    </div>
  );
}
