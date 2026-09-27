import Link from "next/link";
import type { LearnerContextKind } from "@/server/services/ticket-learner-context-service";

/**
 * Secondary contextual support entry point (D-01, UI-SPEC 7.5).
 *
 * The href carries the closed context kind and an already-resolved opaque id
 * ONLY - never titles, amounts, grades or learner details (T-12-12). It is a
 * hint: `/support/new` and the create action re-authorise it server side
 * (T-12-03). With no server-known id nothing is rendered.
 */
export function GetSupportLink({
  kind,
  id,
  label = "Get help with this",
  className,
}: {
  kind: LearnerContextKind;
  id: string | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!id) return null;
  const query = new URLSearchParams({ contextKind: kind, contextId: id });
  return (
    <Link
      href={`/support/new?${query.toString()}`}
      className={className ?? "text-sm font-semibold text-accent hover:underline"}
    >
      {label}
    </Link>
  );
}
