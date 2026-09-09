/**
 * Resolves a session token to an actor.
 *
 * Database sessions rather than stateless tokens, because IAM-03 requires
 * selective and global revocation — a signed token cannot be withdrawn before
 * it expires. A revoked or expired row stops granting access immediately.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";

export async function getActorBySessionToken(
  sessionToken: string | undefined,
): Promise<Actor | null> {
  if (!sessionToken) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    select: {
      expires: true,
      revokedAt: true,
      // isStaff is a presentation hint only, used downstream to choose
      // redirects/chrome (D-15, D-18) — never an authorization input.
      // Authority still comes exclusively from Assignment rows resolved
      // through withPermission.
      user: { select: { id: true, status: true, isStaff: true } },
    },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expires < new Date()) return null;

  // A deactivated account keeps its history but loses access (IAM-04).
  if (session.user.status !== "ACTIVE") return null;

  return { userId: session.user.id, isStaff: session.user.isStaff };
}
