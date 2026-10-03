/**
 * Errors for the software-licence module (Phase 14). Pure: no imports.
 *
 * Neither error is used for a bad licence: a cryptographically invalid,
 * wrong-client or unsupported licence is a structured `{ ok: false, code }`
 * result from `verifyLicence`, never a throw.
 */

/**
 * Infrastructure failure only: the trust set or stored licence state could not
 * be loaded or read (D-04). The caller keeps the last-known-good state for the
 * bounded window and shows an Administrator warning.
 */
export class LicenceUnavailableError extends Error {
  constructor(message = "Licence state is temporarily unavailable.") {
    super(message);
    this.name = "LicenceUnavailableError";
  }
}

/**
 * Raised by an explicit guard (a write path that does not run through
 * `withPermission`) when the deployment is in restricted continuity mode. The
 * message is deliberately neutral so no licence wording can reach a learner.
 */
export class LicenceWriteBlockedError extends Error {
  constructor() {
    super("This action is temporarily unavailable.");
    this.name = "LicenceWriteBlockedError";
  }
}
