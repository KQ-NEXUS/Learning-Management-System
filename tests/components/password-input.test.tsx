// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasswordInput } from "@/components/primitives/PasswordInput";

describe("PasswordInput", () => {
  afterEach(cleanup);

  it("starts hidden and passes input props through", () => {
    const { container } = render(<PasswordInput name="password" autoComplete="current-password" required />);
    const input = container.querySelector("input")!;
    expect(input.type).toBe("password");
    expect(input.name).toBe("password");
    expect(input.autocomplete).toBe("current-password");
    expect(input.required).toBe(true);
  });

  it("shows and hides the password with the eye button, keeping what was typed", () => {
    const { container } = render(<PasswordInput name="password" />);
    const input = container.querySelector("input")!;
    fireEvent.change(input, { target: { value: "hunter2hunter2" } });

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(input.value).toBe("hunter2hunter2");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });

  it("is a non-submit button so toggling never submits the form", () => {
    render(<PasswordInput name="password" />);
    expect(screen.getByRole("button", { name: "Show password" }).getAttribute("type")).toBe("button");
  });
});
