/**
 * Staff steps of the full journey (Phase 15, plan 15-17; D-08), all done
 * through the staff screens the way an operator would: confirm a manual payment,
 * mark attendance, grade and release. Accessible roles and labels only, no CSS
 * selectors, so a UI wording change shows up as a failing locator here.
 */

import { expect, type Browser, type Page } from "@playwright/test";
import { calculatePlatformFeeMinor } from "../../src/server/payments/pricing";
import { JOURNEY, STAFF_LOGINS } from "./journey-fixtures";
import { allowSessionOverHttp } from "./session";

export type StaffRole = keyof typeof STAFF_LOGINS;

/** A separate browser context per staff role, so the learner's own session is untouched. */
export async function openStaffSession(browser: Browser, baseURL: string, role: StaffRole): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signInAsStaff(page, role);
  return page;
}

export async function signInAsStaff(page: Page, role: StaffRole): Promise<void> {
  const login = STAFF_LOGINS[role];
  await page.goto("/signin");
  await page.getByLabel("Email address").fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff(\/|$)/);
  await allowSessionOverHttp(page);
}

/** Base price plus the platform fee: what a manual confirmation must match (zero gateway fee). */
export function expectedManualTotalMinor(): number {
  return JOURNEY.priceNgnMinor + calculatePlatformFeeMinor(JOURNEY.priceNgnMinor);
}

export async function confirmManualPayment(page: Page, orderId: string): Promise<void> {
  await page.goto(`/staff/payments/${orderId}`);
  await page.getByRole("button", { name: "Confirm manual payment" }).click();

  const dialog = page.getByRole("dialog", { name: "Confirm manual payment" });
  await dialog.getByLabel("Amount (minor units)").fill(String(expectedManualTotalMinor()));
  await dialog.getByLabel("Date", { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await dialog.getByLabel("Channel").fill("Bank transfer");
  await dialog.getByLabel("Reference").fill(`journey-${orderId}`);
  await dialog.getByLabel("Evidence / note").fill("Bank statement line held on file for the journey test.");
  await dialog.getByLabel("Reason for manual confirmation").fill("Journey test: payment received by bank transfer.");
  await dialog.getByRole("button", { name: "Confirm payment" }).click();

  // The page re-renders as already paid once the settlement transaction commits.
  await expect(page.getByText("This order is already paid")).toBeVisible();
}

export async function markAttendance(
  page: Page,
  cohortId: string,
  sessionId: string,
  learnerName: string,
): Promise<void> {
  await page.goto(`/staff/cohorts/${cohortId}/sessions/${sessionId}/attendance`);
  const group = page.getByRole("radiogroup", { name: `Attendance for ${learnerName}` });
  await expect(group).toBeVisible();
  await group.getByText("Present", { exact: true }).click();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(page.getByText("Attendance saved")).toBeVisible();
}

export async function gradeAndRelease(
  page: Page,
  cohortId: string,
  assessmentId: string,
  learnerName: string,
  score: number,
): Promise<void> {
  await page.goto(`/staff/cohorts/${cohortId}/grading/${assessmentId}`);
  await page.getByRole("link", { name: new RegExp(learnerName) }).first().click();
  await expect(page).toHaveURL(/\/grading\/[^/]+\/[^/]+$/);

  await page.getByRole("spinbutton", { name: "Score" }).fill(String(score));
  await page.getByRole("textbox", { name: "Feedback" }).fill("Journey test: clear and complete.");
  await page.getByRole("button", { name: "Release", exact: true }).click();

  // After release the draft controls are replaced by the override control.
  await expect(page.getByRole("button", { name: "Override grade" })).toBeVisible();
}
