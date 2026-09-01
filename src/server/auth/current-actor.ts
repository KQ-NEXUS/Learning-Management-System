/**
 * Reads the current actor from the request's session cookie.
 *
 * The cookie name matches Auth.js's default so this keeps working once the
 * full auth configuration lands (Day 3). Everything about validating the
 * session lives in the service layer; this file only reads the request.
 */

import { cookies } from "next/headers";
import { getActorBySessionToken } from "@/server/services/session-service";
import type { Actor } from "@/server/permissions/with-permission";

export const SESSION_COOKIE = "authjs.session-token";
export const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

export async function getCurrentActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token =
    jar.get(SECURE_SESSION_COOKIE)?.value ?? jar.get(SESSION_COOKIE)?.value;
  return getActorBySessionToken(token);
}
