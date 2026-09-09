import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";

/**
 * The root route has no content of its own yet.
 *
 * It will become the public catalogue (PRD §10.1, screens P01–P05). Until
 * then it routes people somewhere useful rather than showing a placeholder.
 */
export default async function Home() {
  const actor = await getCurrentActor();
  redirect(actor ? "/staff/courses" : "/signin");
}
