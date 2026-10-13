import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadPanel } from "@/components/catalogue";
import { CaptionPanel, type CaptionView } from "@/components/catalogue/CaptionPanel";

/**
 * NFR-09 (plan 15-24): the caption authoring panel under a video row.
 * Browser checks are a courtesy; the route and service repeat them (see
 * tests/captions-authoring.integration.test.ts and tests/lesson-resource-routes.test.ts).
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const caption = (overrides: Partial<CaptionView> = {}): CaptionView => ({
  id: "cap-1",
  videoResourceId: "video-1",
  language: "en",
  label: "English",
  uploadStatus: "READY",
  uploadDetail: null,
  ...overrides,
});

function renderPanel(captions: CaptionView[] = []) {
  const onCaptionChange = vi.fn<(caption: CaptionView) => void>();
  const onRequestRemove = vi.fn<(captionId: string) => void>();
  render(
    <CaptionPanel
      lessonId="lesson-1"
      videoResourceId="video-1"
      captions={captions}
      onCaptionChange={onCaptionChange}
      onRequestRemove={onRequestRemove}
    />,
  );
  return { onCaptionChange, onRequestRemove };
}

function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText(/caption file/i), { target: { files: [file] } });
}

const vttFile = () => new File(["WEBVTT\n"], "en.vtt", { type: "text/vtt" });

describe("CaptionPanel", () => {
  it("says there are no captions yet and keeps Add captions disabled until a file is chosen", () => {
    renderPanel();
    expect(screen.getByText(/no captions yet/i)).toBeTruthy();
    const add = screen.getByRole("button", { name: "Add captions" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText("Choose a .vtt file to add captions.")).toBeTruthy();
    chooseFile(vttFile());
    expect(add.disabled).toBe(false);
  });

  it("defaults the language to en and the label to English", () => {
    renderPanel();
    expect((screen.getByLabelText(/caption language/i) as HTMLInputElement).value).toBe("en");
    expect((screen.getByLabelText(/caption label/i) as HTMLInputElement).value).toBe("English");
  });

  it("shows the scan states Scanning, Ready and Failed in words", () => {
    renderPanel([
      caption({ id: "a", label: "English", uploadStatus: "UPLOADING" }),
      caption({ id: "b", label: "French", language: "fr", uploadStatus: "READY" }),
      caption({
        id: "c",
        label: "Hausa",
        language: "ha",
        uploadStatus: "ERROR",
        uploadDetail: "The stored file does not match its upload request.",
      }),
    ]);
    expect(screen.getByText("Scanning")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("English (en)")).toBeTruthy();
    expect(screen.getByText("French (fr)")).toBeTruthy();
    expect(screen.getByText("The stored file does not match its upload request.")).toBeTruthy();
  });

  it("asks to remove the caption it is shown against", () => {
    const { onRequestRemove } = renderPanel([caption({ id: "cap-9", label: "French", language: "fr" })]);
    fireEvent.click(screen.getByRole("button", { name: "Remove captions: French" }));
    expect(onRequestRemove).toHaveBeenCalledWith("cap-9");
  });

  it("refuses a file that is not .vtt before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderPanel();
    chooseFile(new File(["x"], "captions.srt", { type: "application/x-subrip" }));
    expect(screen.getByRole("alert").textContent).toBe("Captions must be a WebVTT (.vtt) file of 1 MB or less.");
    expect((screen.getByRole("button", { name: "Add captions" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a .vtt file over 1 MB before any request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderPanel();
    chooseFile(new File([new Uint8Array(1024 * 1024 + 1)], "big.vtt", { type: "text/vtt" }));
    expect(screen.getByRole("alert").textContent).toBe("Captions must be a WebVTT (.vtt) file of 1 MB or less.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a language that is not a language code, and an empty label", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderPanel();
    chooseFile(vttFile());

    fireEvent.change(screen.getByLabelText(/caption language/i), { target: { value: "english!" } });
    fireEvent.click(screen.getByRole("button", { name: "Add captions" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter the caption language as a language code such as en or fr-CA.",
    );

    fireEvent.change(screen.getByLabelText(/caption language/i), { target: { value: "fr-CA" } });
    fireEvent.change(screen.getByLabelText(/caption label/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add captions" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a caption label of 1 to 60 characters.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs intent, direct PUT and completion in order, naming the video and the caption fields", async () => {
    const file = vttFile();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            resource: { id: "cap-new", uploadStatus: "UPLOADING", uploadDetail: null },
            upload: { url: "https://storage.example/put", method: "PUT", headers: { "Content-Type": "text/vtt" } },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ resource: { id: "cap-new", uploadStatus: "READY", uploadDetail: null } }, 200),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const { onCaptionChange } = renderPanel();

    chooseFile(file);
    fireEvent.change(screen.getByLabelText(/caption language/i), { target: { value: "fr" } });
    fireEvent.change(screen.getByLabelText(/caption label/i), { target: { value: "Francais" } });
    fireEvent.click(screen.getByRole("button", { name: "Add captions" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/lesson-resources/upload-intent");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      lessonId: "lesson-1",
      title: "Francais captions",
      filename: "en.vtt",
      mimeType: "text/vtt",
      sizeBytes: file.size,
      kind: "CAPTION",
      captionForResourceId: "video-1",
      captionLanguage: "fr",
      captionLabel: "Francais",
    });
    expect(fetchSpy.mock.calls[1]).toEqual([
      "https://storage.example/put",
      expect.objectContaining({ method: "PUT", body: file, headers: { "Content-Type": "text/vtt" } }),
    ]);
    expect(fetchSpy.mock.calls[2][0]).toBe("/api/lesson-resources/cap-new/complete");

    await waitFor(() => expect(onCaptionChange).toHaveBeenCalledTimes(2));
    expect(onCaptionChange.mock.calls[0][0]).toMatchObject({
      id: "cap-new",
      videoResourceId: "video-1",
      language: "fr",
      label: "Francais",
      uploadStatus: "UPLOADING",
    });
    expect(onCaptionChange.mock.calls[1][0]).toMatchObject({ id: "cap-new", uploadStatus: "READY" });
  });

  it("shows the server's plain refusal message when the upload cannot be started", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "Captions can only be added to a video in the same lesson." }, 422),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const { onCaptionChange } = renderPanel();

    chooseFile(vttFile());
    fireEvent.click(screen.getByRole("button", { name: "Add captions" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Captions can only be added to a video in the same lesson.",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onCaptionChange).not.toHaveBeenCalled();
  });

  it("still attempts completion after an ambiguous storage network failure", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            resource: { id: "cap-new", uploadStatus: "UPLOADING", uploadDetail: null },
            upload: { url: "https://storage.example/put", method: "PUT", headers: { "Content-Type": "text/vtt" } },
          },
          201,
        ),
      )
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(
        jsonResponse({ resource: { id: "cap-new", uploadStatus: "READY", uploadDetail: null } }, 200),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const { onCaptionChange } = renderPanel();

    chooseFile(vttFile());
    fireEvent.click(screen.getByRole("button", { name: "Add captions" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    expect(fetchSpy.mock.calls[2][0]).toBe("/api/lesson-resources/cap-new/complete");
    await waitFor(() => expect(onCaptionChange).toHaveBeenLastCalledWith(expect.objectContaining({ uploadStatus: "READY" })));
  });
});

describe("UploadPanel with captions", () => {
  const videoRow = {
    id: "video-1",
    title: "Intro video",
    filename: "intro.mp4",
    mimeType: "video/mp4",
    sizeBytes: "1000",
    uploadStatus: "READY" as const,
    uploadDetail: null,
    position: 0,
  };

  it("renders the caption panel under a video row, and never for a file lesson", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { unmount } = render(
      <UploadPanel lessonId="lesson-1" lessonType="VIDEO" initialResources={[videoRow]} initialCaptions={[]} />,
    );
    expect(screen.getByRole("button", { name: "Add captions" })).toBeTruthy();
    unmount();

    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="FILE"
        initialResources={[{ ...videoRow, mimeType: "application/pdf", filename: "notes.pdf" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add captions" })).toBeNull();
  });

  it("loads the lesson's captions with its resources for a video lesson", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        resources: [videoRow],
        captions: [caption({ id: "cap-1", label: "English" })],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    render(<UploadPanel lessonId="lesson-1" lessonType="VIDEO" />);

    expect(await screen.findByText("English (en)")).toBeTruthy();
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/lesson-resources?lessonId=lesson-1&includeCaptions=1");
  });

  it("removes a caption only after confirming, through the caption-only delete, leaving the video", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="VIDEO"
        initialResources={[videoRow]}
        initialCaptions={[caption({ id: "cap-1" })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove captions: English" }));
    const dialog = await screen.findByRole("dialog");
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove captions" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/lesson-resources/cap-1?caption=1", { method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByText("English (en)")).toBeNull());
    expect(screen.getByText("intro.mp4")).toBeTruthy();
  });

  it("shows the refusal when removing a caption fails", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Only caption files can be removed here." }, 422));
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <UploadPanel
        lessonId="lesson-1"
        lessonType="VIDEO"
        initialResources={[videoRow]}
        initialCaptions={[caption({ id: "cap-1" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove captions: English" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove captions" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Only caption files can be removed here.");
    expect(screen.getByText("English (en)")).toBeTruthy();
  });
});
