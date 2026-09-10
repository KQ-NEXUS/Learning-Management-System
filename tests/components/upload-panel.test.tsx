import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "@/components/catalogue";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const uploadingResource = {
  id: "res-1",
  title: "Slides",
  filename: "slides.pdf",
  mimeType: "application/pdf",
  sizeBytes: "3",
  uploadStatus: "UPLOADING" as const,
  uploadDetail: null,
  position: 0,
};
const readyResource = { ...uploadingResource, uploadStatus: "READY" as const };
const errorResource = {
  ...uploadingResource,
  id: "res-error",
  filename: "failed.pdf",
  uploadStatus: "ERROR" as const,
  uploadDetail: "The uploaded object could not be verified.",
};
const intentBody = {
  resource: uploadingResource,
  upload: {
    url: "https://storage.example/presigned-put",
    method: "PUT" as const,
    headers: { "Content-Type": "application/pdf" },
    expiresIn: 900,
  },
};

async function selectPdfAndUpload() {
  const file = new File(["pdf"], "slides.pdf", { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText(/choose file/i), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText(/resource title/i), { target: { value: "Slides" } });
  fireEvent.click(screen.getByRole("button", { name: /upload resource/i }));
  await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3));
  return file;
}

describe("UploadPanel", () => {
  it("runs intent, direct PUT and completion in order and shows Ready", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(intentBody, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ resource: readyResource }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[]} />);

    const file = await selectPdfAndUpload();

    expect(fetchSpy.mock.calls[0][0]).toBe("/api/lesson-resources/upload-intent");
    expect(fetchSpy.mock.calls[1]).toEqual([
      "https://storage.example/presigned-put",
      expect.objectContaining({
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/pdf" },
      }),
    ]);
    expect(fetchSpy.mock.calls[2][0]).toBe("/api/lesson-resources/res-1/complete");
    expect(await screen.findByText("Ready")).toBeTruthy();
  });

  it("calls completion after an ambiguous R2 network failure", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(intentBody, 201))
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(jsonResponse({ resource: readyResource }, 200));
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[]} />);

    await selectPdfAndUpload();

    expect(fetchSpy.mock.calls[2][0]).toBe("/api/lesson-resources/res-1/complete");
    expect(await screen.findByText("Ready")).toBeTruthy();
  });

  it("surfaces the ERROR row and its detail when completion rejects the object", async () => {
    const failed = { ...errorResource, id: "res-1", filename: "slides.pdf" };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(intentBody, 201))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ error: failed.uploadDetail, resource: failed }, 422),
      );
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[]} />);

    await selectPdfAndUpload();

    expect(await screen.findByText("Upload failed")).toBeTruthy();
    expect(
      screen.getAllByText("The uploaded object could not be verified.").length,
    ).toBeGreaterThan(0);
  });

  it("shows Upload failed and removes the row after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[errorResource]} />);

    expect(screen.getByText("Upload failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/lesson-resources/res-error", { method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByText(errorResource.filename)).toBeNull());
  });

  it("does not poll after upload completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(intentBody, 201))
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(jsonResponse({ resource: readyResource }, 200)),
    );
    render(<UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[]} />);

    await selectPdfAndUpload();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("rejects ZIP before making a request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="FILE" initialResources={[]} />);

    fireEvent.change(screen.getByLabelText(/choose file/i), {
      target: { files: [new File(["zip"], "archive.zip", { type: "application/zip" })] },
    });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid image before fetch and explains the accepted formats", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="IMAGE" initialResources={[]} />);

    fireEvent.change(screen.getByLabelText(/choose image/i), {
      target: { files: [new File(["<svg/>"], "diagram.svg", { type: "image/svg+xml" })] },
    });

    expect(
      screen.getByText("Images must be PNG, JPEG, WebP or GIF and under 10 MB."),
    ).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders each upload state and only offers a READY resource for download", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="FILE"
        initialResources={[
          { ...uploadingResource, id: "u" },
          { ...readyResource, id: "r" },
          { ...errorResource, id: "e" },
        ]}
      />,
    );

    expect(screen.getByText("Uploading")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Upload failed")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Download" });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/api/lesson-resources/r/download");
  });
});
