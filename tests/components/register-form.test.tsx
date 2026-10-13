import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/(auth)/register/actions", () => ({ registerAction: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { RegisterForm } from "@/app/(auth)/register/RegisterForm";

afterEach(cleanup);

describe("RegisterForm agreements", () => {
  it("keeps both agreement checkboxes named and required, at a touch-friendly size", () => {
    render(<RegisterForm />);

    for (const name of [/terms of service/i, /privacy notice/i]) {
      const box = screen.getByRole("checkbox", { name }) as HTMLInputElement;
      expect(box.required).toBe(true);
      expect(box.className).toContain("size-6");
    }
  });

  it("opens the policies in a new tab with padded links", () => {
    render(<RegisterForm />);

    for (const [name, href] of [
      ["terms of service", "/policies/terms"],
      ["privacy notice", "/policies/privacy"],
    ]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.className).toContain("py-2");
    }
  });
});
