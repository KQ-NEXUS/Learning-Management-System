/**
 * Plan 11-21 (UAT test 13): the public /verify-certificate reference-entry page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import VerifyEntryPage from "@/app/verify-certificate/page";

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("/verify-certificate entry page", () => {
  it("renders the heading, instructions and a labelled reference field", () => {
    render(<VerifyEntryPage />);
    expect(screen.getByRole("heading", { name: "Verify a certificate" })).toBeTruthy();
    expect(screen.getByText(/Enter the verification reference/)).toBeTruthy();
    expect(screen.getByLabelText(/Verification reference/)).toBeTruthy();
  });

  it("navigates to the URL-encoded /verify/{reference} path on submit", () => {
    render(<VerifyEntryPage />);
    fireEvent.change(screen.getByLabelText(/Verification reference/), {
      target: { value: "CERT-ABC 123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/verify/CERT-ABC%20123");
  });

  it("does not navigate on a blank submit", () => {
    const { container } = render(<VerifyEntryPage />);
    fireEvent.submit(container.querySelector("form")!);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows no catalogue navigation and no sign-in link", () => {
    const { container } = render(<VerifyEntryPage />);
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    for (const forbidden of ["/signin", "/sign-in", "/courses", "/programmes"]) {
      expect(hrefs.some((href) => href.startsWith(forbidden))).toBe(false);
    }
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });
});
