/**
 * Reads the current actor from the request's session cookie.
 *
 * Validation lives in the service layer; this file only reads the request.
 */

import { cookies } from "next/headers";
import { getActorBySessionToken } from "@/server/services/session-service";
import { SESSION_COOKIE } from "@/server/auth/lockout";
import type { Actor } from "@/server/permissions/with-permission";

export { SESSION_COOKIE };

export async function getCurrentActor(): Promise<Actor | null> {
  const jar = await cookies();
  return getActorBySessionToken(jar.get(SESSION_COOKIE)?.value);
}
