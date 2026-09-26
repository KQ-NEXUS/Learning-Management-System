import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { verifyEmail, redirect } = vi.hoisted(() => ({
  verifyEmail: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/server/services/verification-service", () => ({ verificationService: { verifyEmail } }));
vi.mock("@/app/(auth)/verify/ResendVerificationForm", () => ({ ResendVerificationForm: () => null }));
vi.mock("@/app/(auth)/reset-password/ResetPasswordForm", () => ({ ResetPasswordForm: () => <form aria-label="reset" /> }));
vi.mock("@/app/(auth)/forgot-password/actions", () => ({ forgotPasswordAction: vi.fn() }));

import VerifyPage from "@/app/(auth)/verify/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const params = (value: Record<string, string>) => Promise.resolve(value);

describe("F-11 — a contested registration's verifier sets their own password", () => {
  it("verify sends a contested account straight to set a password", async () => {
    verifyEmail.mockResolvedValue({ ok: true, setPasswordToken: "reset-abc" });
    await expect(VerifyPage({ searchParams: params({ token: "tok" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/reset-password?token=reset-abc&set=1",
    );
  });

  it("an ordinary verification still offers sign-in", async () => {
    verifyEmail.mockResolvedValue({ ok: true });
    render(await VerifyPage({ searchParams: params({ token: "tok" }) }));
    expect(screen.getByText("Email verified")).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("the reset page explains the set-password case", async () => {
    render(await ResetPasswordPage({ searchParams: params({ token: "reset-abc", set: "1" }) }));
    expect(screen.getByText("Set your password")).toBeTruthy();
  });

  it("the ordinary reset page is unchanged", async () => {
    render(await ResetPasswordPage({ searchParams: params({ token: "reset-abc" }) }));
    expect(screen.getByText("Choose a new password")).toBeTruthy();
  });
});
