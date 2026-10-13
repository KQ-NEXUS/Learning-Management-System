import type { LearnerNavItem } from "@/components/shell/LearnerShell";

/**
 * The one learner header navigation. `(learner)`, `account` and `(checkout)`
 * layouts all use this list so the links never differ between pages.
 */
export const LEARNER_NAV: LearnerNavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "My learning", href: "/learn" },
  { label: "Support", href: "/support" },
  { label: "Catalogue", href: "/courses" },
  { label: "Account", href: "/account" },
];
