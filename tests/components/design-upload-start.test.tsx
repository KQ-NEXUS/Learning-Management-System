/**
 * "Start from an uploaded design": upload a school's certificate artwork, then land in the template
 * editor with it as the full-page background and the four dynamic fields on top.
 *
 * The three collaborators that need a browser or a server (image decoding, the direct PUT to
 * storage, the presign/confirm server actions) are injected, so this exercises the real form,
 * the real layout builder and the real editor shell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesignUploadStart } from "@/app/staff/certificates/templates/DesignUploadStart";
import { TemplatesTable } from "@/app/staff/certificates/templates/TemplatesTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const presign = vi.fn();
const confirm = vi.fn();
const put = vi.fn();
const measure = vi.fn();

beforeEach(() => {
  presign.mockResolvedValue({ ok: true, stagedKey: "certificate-template-asset-uploads/draft/x", uploadUrl: "https://storage.example/put", expiresIn: 60 });
  confirm.mockResolvedValue({ ok: true, assetKey: "certificate-template-assets/draft/final" });
  put.mockResolvedValue(true);
  measure.mockResolvedValue({ width: 2000, height: 1414 });
  URL.createObjectURL = vi.fn(() => "blob:design-preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderForm() {
  return render(<DesignUploadStart presign={presign} confirm={confirm} measure={measure} put={put} />);
}

function file(name = "design.png", type = "image/png", bytes = 1024) {
  return new File([new Uint8Array(bytes)], name, { type });
}

async function choose(f: File) {
  const input = screen.getByLabelText(/Certificate design/) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [f] } });
}

const continueButton = () => screen.getByRole("button", { name: /Continue to editor|Uploading/ }) as HTMLButtonElement;

describe("DesignUploadStart", () => {
  it("keeps Continue disabled until a valid design is chosen", async () => {
    renderForm();
    expect(continueButton().disabled).toBe(true);

    await choose(file());
    await waitFor(() => expect(continueButton().disabled).toBe(false));
  });

  it("refuses a file that isn't a PNG or JPEG before anything is uploaded", async () => {
    renderForm();
    await choose(file("design.webp", "image/webp"));

    expect((await screen.findByRole("alert")).textContent).toContain("PNG or JPEG");
    expect(continueButton().disabled).toBe(true);
    expect(presign).not.toHaveBeenCalled();
  });

  it("refuses an image it cannot read", async () => {
    measure.mockRejectedValue(new Error("unreadable"));
    renderForm();
    await choose(file());

    expect((await screen.findByRole("alert")).textContent).toContain("could not be read");
    expect(continueButton().disabled).toBe(true);
  });

  it("tells staff the shape it detected, and warns only when the image would be stretched", async () => {
    measure.mockResolvedValue({ width: 1920, height: 1080 });
    renderForm();
    await choose(file());
    expect((await screen.findByText(/1920 × 1080 px, so a landscape page/)).textContent).toContain("stretched");

    measure.mockResolvedValue({ width: 2000, height: 1414 });
    await choose(file("better.png"));
    await waitFor(() => expect(screen.getByText(/2000 × 1414 px/).textContent).not.toContain("stretched"));
  });

  it("detects a portrait design", async () => {
    measure.mockResolvedValue({ width: 1000, height: 1414 });
    renderForm();
    await choose(file());
    expect(await screen.findByText(/so a portrait page/)).toBeTruthy();
  });

  it("uploads through the editor's own pipeline, then opens the editor on an unsaved template", async () => {
    renderForm();
    await choose(file());
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());

    // The editor is open: Save is enabled straight away, and the design shows on the canvas.
    const save = (await screen.findByRole("button", { name: "Save template" })) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(document.querySelector('img[src="blob:design-preview"]')).toBeTruthy();

    expect(presign).toHaveBeenCalledWith(expect.objectContaining({ templateId: "draft", mimeType: "image/png", filename: "design.png" }));
    expect(put).toHaveBeenCalledWith("https://storage.example/put", expect.any(File));
    expect(confirm).toHaveBeenCalledWith({ stagedKey: "certificate-template-asset-uploads/draft/x", contentType: "image/png", sizeBytes: 1024 });
    // The blob the canvas draws from must not be released when the editor takes over.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:design-preview");
  });

  it("stays on the form and explains when the upload is refused", async () => {
    presign.mockResolvedValue({ ok: false, message: "Your role does not permit uploading certificate template images." });
    renderForm();
    await choose(file());
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());

    expect((await screen.findByRole("alert")).textContent).toContain("does not permit");
    expect(put).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
  });

  it("stays on the form when storage rejects the file", async () => {
    put.mockResolvedValue(false);
    renderForm();
    await choose(file());
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());

    expect((await screen.findByRole("alert")).textContent).toContain("The upload failed. Try again.");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stays on the form when the server's verification of the stored file fails", async () => {
    confirm.mockResolvedValue({ ok: false, message: "This image could not be verified. Choose a PNG or JPEG under 10 MB and try again." });
    renderForm();
    await choose(file());
    await waitFor(() => expect(continueButton().disabled).toBe(false));
    fireEvent.click(continueButton());

    expect((await screen.findByRole("alert")).textContent).toContain("could not be verified");
    expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
  });
});

describe("Templates list entry point", () => {
  it("offers Upload existing design beside New template to staff who can create", () => {
    render(<TemplatesTable rows={[]} canCreate />);
    const links = screen.getAllByRole("link", { name: "Upload existing design" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toBe("/staff/certificates/templates/from-design");
  });

  it("hides it from staff who cannot create templates", () => {
    render(<TemplatesTable rows={[]} canCreate={false} />);
    expect(screen.queryByRole("link", { name: "Upload existing design" })).toBeNull();
  });
});
