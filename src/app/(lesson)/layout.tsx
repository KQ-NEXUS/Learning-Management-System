import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentActor } from "@/server/auth/current-actor";

/**
 * The `(lesson)` route-group layout — `/learn/[enrolmentId]/lessons/[lessonId]` only.
 *
 * A lesson is a focus screen: it draws its own frame (a navy course outline beside a white
 * reading sheet) instead of the learner shell's top bar, so it lives in its own group. The
 * group's parentheses keep the URL exactly `/learn/[enrolmentId]/lessons/[lessonId]`.
 *
 * DD-20: this guard is convenience only, like `(learner)/layout.tsx`'s — the page and every
 * Server Action beneath it re-resolve the actor and re-check ownership.
 */
export default async function LessonGroupLayout({ children }: { children: ReactNode }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  return <div className="min-h-screen bg-sidebar-bg">{children}</div>;
}
