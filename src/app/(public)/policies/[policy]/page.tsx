import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { SUPPORT_CONTACT_EMAIL } from "@/server/support-contact";

/**
 * The three policy pages the sign-up and checkout consent checkboxes link to. The
 * allowlist below is closed: any other slug is a 404. The text itself belongs to the
 * training provider (it is legal wording), so each page carries a clearly marked
 * placeholder until they supply it.
 */
const POLICIES = {
  terms: "Terms of Service",
  "refund-cancellation": "Refund and Cancellation Policy",
  privacy: "Privacy Notice",
} as const;

type PolicySlug = keyof typeof POLICIES;

export function generateStaticParams() {
  return (Object.keys(POLICIES) as PolicySlug[]).map((policy) => ({ policy }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ policy: string }>;
}): Promise<Metadata> {
  const { policy } = await params;
  const title = POLICIES[policy as PolicySlug];
  return { title: title ?? "Policy" };
}

export default async function PolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params;
  const title = POLICIES[policy as PolicySlug];
  if (!title) notFound();

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader title={title} />
      <div className="flex max-w-[65ch] flex-col gap-4 text-base text-foreground-soft">
        <p>[POLICY TEXT: the provider&apos;s {title} is published here.]</p>
        <p className="text-sm text-muted-foreground">
          Questions about this policy? Email{" "}
          <a href={`mailto:${SUPPORT_CONTACT_EMAIL}`} className="text-accent underline underline-offset-2">
            {SUPPORT_CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
