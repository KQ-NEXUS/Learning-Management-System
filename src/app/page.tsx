import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { landingPathFor } from "@/server/auth/landing";

/**
 * The root route has no content of its own: it sends each visitor where they belong.
 * A signed-in person goes to their own landing page (staff to the workspace, a learner to
 * their dashboard, exactly as after sign-in); an anonymous visitor goes to the public
 * catalogue, which is the site's front door.
 */
export default async function Home() {
  const actor = await getCurrentActor();
  redirect(actor ? landingPathFor(actor) : "/courses");
}
