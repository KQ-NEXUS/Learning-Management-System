/**
 * The diagnostic download control (Phase 14, plan 14-15; LIC-02, D-14,
 * 14-UI-SPEC "Data and diagnostics"): fetches the route, saves the response as a
 * file, shows the fixed error on failure, never disabled by licence state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiagnosticDownloadButton } from "@/app/staff/licence/DiagnosticDownloadButton";
import { DIAGNOSTIC_BUTTON_LABEL, DIAGNOSTIC_ERROR_MESSAGE } from "@/server/licence/policy";

const createObjectURL = vi.fn(() => "blob:diagnostic");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeObjectURL });
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(): HTMLButtonElement {
  return screen.getByRole("button", { name: DIAGNOSTIC_BUTTON_LABEL }) as HTMLButtonElement;
}

describe("DiagnosticDownloadButton", () => {
  it("Test 4: has the policy label, is enabled, and offers no other control", () => {
    render(<DiagnosticDownloadButton />);
    expect(DIAGNOSTIC_BUTTON_LABEL).toBe("Download diagnostic report");
    expect(button().disabled).toBe(false);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Test 4: clicking fetches the route with no caching and saves the response under the Content-Disposition name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"reportVersion":1}', {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="licence-diagnostic-LIC-2026-0001-20261002.json"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const downloads: Array<{ download: string; href: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ download: this.download, href: this.href });
    });

    render(<DiagnosticDownloadButton />);
    fireEvent.click(button());

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/staff/licence/diagnostic");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
    expect(downloads[0]).toEqual({
      download: "licence-diagnostic-LIC-2026-0001-20261002.json",
      href: "blob:diagnostic",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    // The temporary anchor is removed again, and the object URL is released shortly after.
    expect(document.querySelector("a[download]")).toBeNull();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:diagnostic"), { timeout: 3000 });
  });

  it("falls back to licence-diagnostic.json when the header is missing or not a plain name", async () => {
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response("{}", { status: 200, headers: { "Content-Disposition": 'attachment; filename="../../x.json"' } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<DiagnosticDownloadButton />);
    fireEvent.click(button());
    await waitFor(() => expect(downloads).toHaveLength(1));
    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(downloads).toEqual(["licence-diagnostic.json", "licence-diagnostic.json"]);
  });

  it("Test 4: a non-OK response shows the fixed danger note and saves nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<DiagnosticDownloadButton />);
    fireEvent.click(button());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(DIAGNOSTIC_ERROR_MESSAGE);
    expect(alert.textContent).toBe("Diagnostic report not downloaded. Try again.");
    expect(alert.className).toMatch(/border-danger/);
    expect(click).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(button().disabled).toBe(false));
  });

  it("a network failure shows the same note without its message, and a later success clears it", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<DiagnosticDownloadButton />);
    fireEvent.click(button());
    expect((await screen.findByRole("alert")).textContent).toBe(DIAGNOSTIC_ERROR_MESSAGE);
    expect(document.body.textContent).not.toContain("network down");

    await waitFor(() => expect(button().disabled).toBe(false));
    fireEvent.click(button());
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("is inert only while its own request is in flight, so one click is one download", async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<DiagnosticDownloadButton />);
    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));
    fireEvent.click(button());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(new Response("{}", { status: 200 }));
    await waitFor(() => expect(button().disabled).toBe(false));
  });
});
