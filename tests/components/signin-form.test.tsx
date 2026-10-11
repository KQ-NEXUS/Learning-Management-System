/**
 * A failed sign-in keeps the email that was typed and moves focus to the error
 * message, so a keyboard or screen-reader user is not dropped back at the top.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const signInAction = vi.hoisted(() => vi.fn());
vi.mock("@/app/(auth)/signin/actions", () => ({ signInAction }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { SignInForm } from "@/app/(auth)/signin/SignInForm";

afterEach(() => {
  cleanup();
  signInAction.mockReset();
});

// UI-SPEC S4 (D-16) — one message for a wrong password, an unknown address
// and an unverified account.
const S4_MESSAGE =
  "Those details do not match an account. If you've registered but not verified your email yet, use the link in the verification email we sent you, then sign in.";

describe("SignInForm after a failed attempt", () => {
  it("keeps the email, empties no other field it should not, and focuses the alert", async () => {
    signInAction.mockResolvedValue({
      error: S4_MESSAGE,
      email: "ada@example.com",
      attempt: 1,
    });
    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "ada@example.com" } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("do not match");
    expect(alert.textContent).toBe(S4_MESSAGE);
    expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("ada@example.com");
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it("the S4 message is the sentence the action returns for every INVALID result", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/app/(auth)/signin/actions.ts", "utf8");
    expect(source).toContain(JSON.stringify(S4_MESSAGE));
  });

  it("shows no alert and does not steal focus before anything is submitted", () => {
    render(<SignInForm />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});
