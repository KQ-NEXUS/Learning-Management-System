/**
 * Reads the current actor from the request's session cookie.
 *
 * Validation lives in the service layer; this file only reads the request.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { getActorBySessionToken } from "@/server/services/session-service";
import { SESSION_COOKIE } from "@/server/auth/lockout";
import type { Actor } from "@/server/permissions/with-permission";

export { SESSION_COOKIE };

// Request-scoped only, never across requests: revocation must be immediate (IAM-03, NFR-02).
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  return getActorBySessionToken(jar.get(SESSION_COOKIE)?.value);
});
