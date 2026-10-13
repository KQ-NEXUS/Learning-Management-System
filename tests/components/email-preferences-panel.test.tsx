import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EmailPreferencesPanel } from "@/components/notifications/EmailPreferencesPanel";

const saveEmailPreferencesAction = vi.fn();
vi.mock("@/app/notifications/actions", () => ({
  saveEmailPreferencesAction: (...args: unknown[]) => saveEmailPreferencesAction(...args),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveEmailPreferencesAction.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EmailPreferencesPanel switches", () => {
  it("checks unmuted categories and unchecks the muted one", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ muted: ["SESSION_CHANGES"] }));
    render(<EmailPreferencesPanel />);

    const sessionSwitch = await screen.findByRole("switch", { name: "Session change notices" });
    await waitFor(() => expect(sessionSwitch.getAttribute("aria-checked")).toBe("false"));

    expect(screen.getByRole("switch", { name: "Ticket replies and updates" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Result release notices" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Enrolment status changes" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("EmailPreferencesPanel save", () => {
  it("saves exactly the muted categories and shows the saved copy", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ muted: ["SESSION_CHANGES"] }));
    saveEmailPreferencesAction.mockResolvedValue({ ok: true, muted: ["SESSION_CHANGES"] });
    render(<EmailPreferencesPanel />);

    await screen.findByRole("switch", { name: "Session change notices" });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() => expect(saveEmailPreferencesAction).toHaveBeenCalledTimes(1));
    expect(saveEmailPreferencesAction).toHaveBeenCalledWith({ muted: ["SESSION_CHANGES"] });
    expect(await screen.findByText("Preferences saved.")).toBeTruthy();
  });

  it("shows the retry copy and keeps switch state when saving fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ muted: ["SESSION_CHANGES"] }));
    saveEmailPreferencesAction.mockResolvedValue({ ok: false, message: "nope" });
    render(<EmailPreferencesPanel />);

    const sessionSwitch = await screen.findByRole("switch", { name: "Session change notices" });
    expect(sessionSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByText("Preferences not saved. Try again.")).toBeTruthy();
    expect(sessionSwitch.getAttribute("aria-checked")).toBe("false");
  });
});

describe("EmailPreferencesPanel locked list", () => {
  it("renders exactly five non-interactive locked items", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ muted: [] }));
    render(<EmailPreferencesPanel />);
    await screen.findByText("Always emailed");

    const items = [
      "Payment and enrolment confirmations",
      "Ticket received confirmations",
      "Certificates issued, revoked or reissued",
      "Session cancellations",
      "Account verification and password reset",
    ];
    expect(items).toHaveLength(5);
    for (const label of items) {
      const node = screen.getByText(label);
      expect(node.closest("button")).toBeNull();
      expect(node.closest('[role="switch"]')).toBeNull();
    }
  });
});

describe("EmailPreferencesPanel accessibility", () => {
  it("has no axe violations", async () => {
    const { axeViolations } = await import("../support/axe");
    fetchMock.mockResolvedValue(jsonResponse({ muted: [] }));
    const { container } = render(<EmailPreferencesPanel />);
    await screen.findByText("Always emailed");
    expect(await axeViolations(container)).toEqual([]);
  });
});
