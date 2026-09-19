/**
 * Authorized download for a certificate PDF (CRD-03, T-11-51/T-11-59/T-11-60).
 *
 * Denial-parity rule (load-bearing, one sentence): every non-success outcome —
 * wrong owner, unknown id, revoked, missing storage key, unauthenticated — is
 * a 404 with an empty body, and no other status is ever returned, so nobody
 * later "improves" the developer experience with a 403 for unauthorized and
 * a 404 for missing, which would turn this route into an oracle for which
 * certificate ids exist.
 *
 * Two authorization predicates share this route, mirroring
 * `lesson-resources/[id]/download/route.ts`'s structure exactly: staff
 * `certificates.view` in matching scope (`certificateService.get`) is tried
 * first, with an `AuthenticationError`/`AuthorizationError` swallowed to
 * `null` so it falls through to the learner ownership predicate
 * (`getOwnCertificateForDownload`, T-11-51) rather than failing the request
 * outright. That learner predicate itself returns `null` — never throws —
 * for a `REVOKED` certificate (T-11-60, UI-SPEC §7.6 branch 5) and for a
 * flagged-but-`ACTIVE` certificate still succeeds (branch 4 — a flag never
 * withdraws already-earned access).
 *
 * Deliberately no route-config export opting into caching and no cache
 * wrapper anywhere in this file (RESEARCH Pitfall 6): a cached presigned URL
 * would outlive its 60-second TTL and serve a dead link, and a cached 302
 * could be served to a different learner than the one who requested it. The
 * Prisma read inside `certificateService.get`/`getOwnCertificateForDownload`
 * already defers this handler to request time per Next 16's Cache Components
 * model; the private, non-cacheable header on the hand-built 302 below is
 * the second, explicit layer (T-11-10).
 *
 * A certificate row can exist before its file (two-phase issuance, plan 11-30:
 * the PDF is produced after the issuing transaction commits, and that step is
 * best effort). When an ALREADY-AUTHORIZED caller reaches a row with no
 * `storageKey`, the file is produced here, on first access, through
 * `ensureCertificateFile` (idempotent, never throws), and only then presigned.
 * It runs strictly AFTER both authorization predicates, so an unauthorized,
 * unknown or revoked certificate never triggers a render (T-11-129, T-11-130).
 * Denial parity is unchanged: a failure to produce the file maps to the same
 * empty 404, indistinguishable from any denial.
 */

import { NextResponse } from "next/server";
import * as permissions from "@/server/permissions";
import { getCurrentActor } from "@/server/auth/current-actor";
import { certificateService, getOwnCertificateForDownload } from "@/server/services/certificate-service";
import { ensureCertificateFile } from "@/server/services/certificate-file-service";
import { presignCertificateObjectUrl } from "@/server/services/storage-service";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  try {
    // Staff path first. A failed `certificates.view` check (Authentication or
    // Authorization) is swallowed to `null` here so it can fall through to
    // the learner path below, rather than failing the request outright.
    let certificate = await certificateService.get(id).catch((err) => {
      if (
        err instanceof permissions.AuthenticationError ||
        err instanceof permissions.AuthorizationError
      ) {
        return null;
      }
      throw err;
    });

    if (!certificate) {
      // No session at all -> 404 without attempting a learner lookup with a
      // null actor.
      const actor = await getCurrentActor();
      certificate = actor ? await getOwnCertificateForDownload(actor, id) : null;
    }

    // Denial: wrong owner, unknown id, revoked, unauthenticated. Same empty 404
    // as every other outcome; nothing below runs for these.
    if (!certificate) {
      return new NextResponse(null, { status: 404 });
    }

    // Authorized from here on. A row can exist before its file (two-phase
    // issuance): produce it now, awaited (no fire-and-forget), and use the key
    // it returns. `ensureCertificateFile` never rejects; `null` means the file
    // could not be produced and is the same empty 404, never a 500.
    const storageKey = certificate.storageKey ?? (await ensureCertificateFile(certificate.id));
    if (!storageKey) {
      return new NextResponse(null, { status: 404 });
    }

    const url = await presignCertificateObjectUrl({ key: storageKey });

    // Built by hand rather than via the platform's redirect helper so the
    // non-cacheable header rides along: no shared cache may retain the
    // resolved location.
    return new NextResponse(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    throw err;
  }
}
