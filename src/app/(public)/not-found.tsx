import Link from "next/link";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";

/**
 * The public-segment 404. Same properties as the root one — it reveals nothing
 * about why a slug did not resolve, so an unlisted, an archived and a
 * never-existed course are indistinguishable (T-04-68) — with the public
 * navigation instead of the bare shell.
 *
 * Copy is the approved recovery text from 04.1-UI-SPEC §6.2 (verbatim, straight
 * apostrophe per 04.1-MOCKUP-SOURCE.html) — deliberately non-enumerating.
 */
export default function PublicNotFound() {
  return (
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
  );
}
