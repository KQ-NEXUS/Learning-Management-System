import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadPanel, type LessonResourceView } from "@/components/catalogue";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const resource = (
  scanStatus: LessonResourceView["scanStatus"],
  overrides: Partial<LessonResourceView> = {},
): LessonResourceView => ({
  id: `resource-${scanStatus.toLowerCase()}`,
  title: `${scanStatus} resource`,
  filename: `${scanStatus.toLowerCase()}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: "1024",
  scanStatus,
  scanDetail: null,
  position: 0,
  ...overrides,
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("UploadPanel", () => {
  it("rejects an invalid image before fetch and explains the accepted formats and cap", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <UploadPanel lessonId="lesson-1" lessonType="IMAGE" initialResources={[]} maxPolls={0} />,
    );

    fireEvent.change(screen.getByLabelText("Choose image"), {
      target: { files: [new File(["<svg/>"], "diagram.svg", { type: "image/svg+xml" })] },
    });

    expect(
      screen.getByText("Images must be PNG, JPEG, WebP or GIF and under 10 MB."),
    ).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uploads the raw File to the Route Handler with metadata in the query string", async () => {
    const fetchSpy = vi.fn(() => jsonResponse({ id: "resource-new", scanStatus: "PENDING" }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[]} maxPolls={0} />,
    );

    const file = new File(["slides"], "slides.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("Choose file"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Resource title"), {
      target: { value: "Week one slides" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload resource" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/api/lesson-resources/upload");
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      lessonId: "lesson-1",
      title: "Week one slides",
      filename: "slides.pdf",
      mimeType: "application/pdf",
      sizeBytes: String(file.size),
    });
    expect(init).toMatchObject({ method: "POST", body: file });
    expect(screen.getByText("Scanning")).toBeTruthy();
  });

  it("renders each scan state and never offers an infected file for download", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="FILE"
        maxPolls={0}
        initialResources={[
          resource("PENDING"),
          resource("CLEAN"),
          resource("INFECTED", { scanDetail: "Eicar-Test-Signature" }),
          resource("ERROR", { scanDetail: "Scanner unavailable" }),
        ]}
      />,
    );

    expect(screen.getByText("Scanning")).toBeTruthy();
    expect(screen.getByText("Clean")).toBeTruthy();
    expect(screen.getByText("Infected")).toBeTruthy();
    expect(screen.getByText("Scan error")).toBeTruthy();
    expect(screen.getByText("Eicar-Test-Signature")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Download" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/api/lesson-resources/resource-clean/download");
  });

  it("retries an ERROR resource through the retry endpoint and returns it to Scanning", async () => {
    const pending = resource("PENDING", { id: "resource-error", title: "Errored resource" });
    const fetchSpy = vi.fn(() => jsonResponse({ resource: pending }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="FILE"
        maxPolls={0}
        initialResources={[resource("ERROR", { id: "resource-error" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry scan" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/lesson-resources/resource-error/retry");
    expect(init).toMatchObject({ method: "POST" });
    expect(screen.getByText("Scanning")).toBeTruthy();
  });

  it("keeps an ERROR resource visible and surfaces the reason when the retry cannot be queued", async () => {
    const rolledBack = resource("ERROR", {
      id: "resource-error",
      scanDetail: "The scan could not be queued. Try again in a moment.",
    });
    const fetchSpy = vi.fn(() =>
      jsonResponse(
        { error: "The scan could not be queued. Try again in a moment.", resource: rolledBack },
        503,
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="FILE"
        maxPolls={0}
        initialResources={[resource("ERROR", { id: "resource-error" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry scan" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "The scan could not be queued. Try again in a moment.",
      ),
    );
    expect(screen.getByText("Scan error")).toBeTruthy();
    expect(screen.queryByText("Scanning")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeTruthy();
  });

  it("bounds status polling and stops scheduling work after unmount", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(() =>
      jsonResponse({ resources: [resource("PENDING", { id: "resource-pending" })] }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const view = render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="FILE"
        initialResources={[resource("PENDING", { id: "resource-pending" })]}
        pollIntervalMs={25}
        maxPolls={2}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
