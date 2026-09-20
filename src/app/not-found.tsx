import Link from "next/link";
import { LearnerShell } from "@/components/shell/LearnerShell";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";

/**
 * The repository's root 404 (a carried gap in STATE.md until now).
 *
 * It reveals nothing about WHY: the same page serves "no such page", "no such
 * course", "that course is not publicly listed" and "that course is archived"
 * (T-04-68). Next renders this with an HTTP 404 status.
 *
 * Copy is the approved recovery text from 04.1-UI-SPEC §6.2 (verbatim, straight
 * apostrophe per 04.1-MOCKUP-SOURCE.html) — deliberately non-enumerating: it
 * names no record and confirms no existence. It sits in the shared frame with
 * no nav, so it also reveals nothing about who is signed in.
 */
export default function NotFound() {
  return (
    <LearnerShell nav={[]} rightSlot={null}>
      <div className="flex flex-col gap-8">
        <LearnerPageHeader title="We can't find that page" />
        <div className="flex flex-col gap-4 pb-12">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <p className="max-w-prose text-base text-foreground-soft">
          The course or programme may have been archived, or the link may be out of date.
        </p>
        <Link
          href="/courses"
          className="inline-flex min-h-11 w-fit items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
        >
          Back to the catalogue
        </Link>
        </div>
      </div>
    </LearnerShell>
  );
}
