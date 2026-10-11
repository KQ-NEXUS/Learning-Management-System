/**
 * WebKit session cookie over plain http (Phase 15, plan 15-17; D-14).
 *
 * The application sets its session cookie with the Secure flag, as it does in
 * production, and the journey runs it over http://localhost. Chromium and
 * Firefox send a Secure cookie to http://localhost; Playwright's WebKit stores it
 * but never sends it on a real request (the redirect that follows sign-in works
 * only because the server renders that page inside the same response). The next
 * page load then looks signed out.
 *
 * For WebKit only, this re-adds the same session value without the Secure flag
 * for the local test origin, so every later step runs as the same signed-in user.
 * The application is untouched, the cookie value is not changed, and no step is
 * skipped. Real Safari over https is covered by the manual pass.
 */

import type { Page } from "@playwright/test";

const SESSION_COOKIE = "lms.session";

export async function allowSessionOverHttp(page: Page): Promise<void> {
  const context = page.context();
  if (context.browser()?.browserType().name() !== "webkit") return;

  const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
  if (!session) return;

  const origin = new URL(page.url()).origin;
  await context.clearCookies({ name: SESSION_COOKIE });
  await context.addCookies([
    {
      name: session.name,
      value: session.value,
      url: origin,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires: session.expires,
    },
  ]);
}
