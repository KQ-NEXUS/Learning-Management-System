/**
 * The two-step licence activation form (Phase 14, plan 14-15; LIC-03, D-14,
 * T-14-15-02, T-14-15-03, 14-UI-SPEC "Activation flow"). The server actions are
 * mocked: this file covers the interaction contract, not verification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), activate: vi.fn() }));

vi.mock("@/app/staff/licence/actions", () => ({
  inspectLicenceAction: mocks.inspect,
  activateLicenceAction: mocks.activate,
}));

import { ActivateLicenceForm } from "@/app/staff/licence/ActivateLicenceForm";
import { MAX_LICENCE_FILE_CHARS } from "@/server/licence/constants";
import { ACTIVATE_CONFIRM_BODY, rejectionSentence } from "@/server/licence/policy";

const RAW = "LMS-LIC1.aGVhZGVy.cGF5bG9hZA.c2ln";
const BAD_FORMAT = `${rejectionSentence("BAD_FORMAT")} Nothing was changed.`;
const FORBIDDEN_NAME = /\b(create|extend|edit|replace|reactivate)/i;

const PREVIEW = {
  licenceId: "LIC-2026-0002",
  clientName: "Fixture Training Academy",
  deploymentId: "fixture-deployment-0001",
  zone: "Africa/Lagos",
  issued: { local: "30 Sep 2026, 13:00 WAT", utc: "2026-09-30T12:00:00Z" },
  starts: { local: "1 Oct 2026, 01:00 WAT", utc: "2026-10-01T00:00:00Z" },
  expires: { local: "31 Mar 2027, 23:59 WAT", utc: "2027-03-31T22:59:59Z" },
  graceEnds: { local: "14 Apr 2027, 23:59 WAT", utc: "2027-04-14T22:59:59Z" },
  replaces: null,
  matchesDeployment: true as const,
};

beforeEach(() => {
  mocks.inspect.mockReset();
  mocks.activate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeFile(content: string, name = "licence.lic") {
  const file = new File([content], name);
  const text = vi.fn().mockResolvedValue(content);
  Object.defineProperty(file, "text", { value: text });
  return { file, text };
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function pasteBox(): HTMLTextAreaElement {
  return screen.getByLabelText("Or paste the licence text") as HTMLTextAreaElement;
}

function checkButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^(Check licence|Checking…)$/ }) as HTMLButtonElement;
}

function paste(value: string) {
  fireEvent.change(pasteBox(), { target: { value } });
}

async function chooseFile(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(file.name)).toBeTruthy());
}

async function reachPreview(preview: Record<string, unknown> = PREVIEW) {
  mocks.inspect.mockResolvedValue({ ok: true, preview });
  render(<ActivateLicenceForm />);
  paste(RAW);
  fireEvent.click(checkButton());
  await screen.findByText("Verified");
}

function openDialog() {
  const trigger = screen.getByRole("button", { name: "Activate licence" });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog") };
}

describe("choosing input", () => {
  it("Test 1: Check licence is disabled until there is input; whichever of file and paste is set last wins and clears the other; the textarea is monospace", async () => {
    render(<ActivateLicenceForm />);
    expect(checkButton().disabled).toBe(true);
    expect(pasteBox().className).toMatch(/\bfont-mono\b/);

    paste(RAW);
    expect(checkButton().disabled).toBe(false);

    // A file chosen after pasting wins: the textarea clears.
    const { file } = makeFile("FILE-TEXT.aaa.bbb");
    await chooseFile(file);
    expect(pasteBox().value).toBe("");
    expect(checkButton().disabled).toBe(false);

    // Typing after the file wins: the file name clears.
    paste(RAW);
    expect(screen.queryByText("licence.lic")).toBeNull();
    expect(screen.getByText("No file chosen")).toBeTruthy();
    expect(fileInput().value).toBe("");

    // Whitespace alone is not input.
    paste("   \n  ");
    expect(checkButton().disabled).toBe(true);
  });

  it("Test 1: the file that won is the text that is inspected, not the earlier paste", async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: "BAD_SIGNATURE", message: "x", neutral: false });
    render(<ActivateLicenceForm />);
    paste(RAW);
    const { file } = makeFile("FILE-TEXT.aaa.bbb\n");
    await chooseFile(file);
    fireEvent.click(checkButton());
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(1));
    expect(mocks.inspect).toHaveBeenCalledWith({ raw: "FILE-TEXT.aaa.bbb" });
  });

  it("Test 2: a file of 8193 bytes shows the BAD_FORMAT sentence, is never read and never inspected", async () => {
    render(<ActivateLicenceForm />);
    const { file, text } = makeFile("A".repeat(MAX_LICENCE_FILE_CHARS + 1), "big.lic");
    expect(file.size).toBe(MAX_LICENCE_FILE_CHARS + 1);

    fireEvent.change(fileInput(), { target: { files: [file] } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(BAD_FORMAT);
    expect(text).not.toHaveBeenCalled();
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(checkButton().disabled).toBe(true);
    expect(screen.queryByText("big.lic")).toBeNull();
  });

  it("Test 2: a valid small file is read with file.text() and inspected", async () => {
    mocks.inspect.mockResolvedValue({ ok: false, code: "BAD_SIGNATURE", message: "x", neutral: false });
    render(<ActivateLicenceForm />);
    const { file, text } = makeFile(`  ${RAW}\n`);
    await chooseFile(file);
    expect(text).toHaveBeenCalledTimes(1);

    fireEvent.click(checkButton());
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith({ raw: RAW }));
  });

  it("Test 2: pasted text over 8192 characters is rejected before the action is called", async () => {
    render(<ActivateLicenceForm />);
    paste("A".repeat(MAX_LICENCE_FILE_CHARS + 1));
    fireEvent.click(checkButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(BAD_FORMAT);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });

  it("an empty file shows the BAD_FORMAT sentence instead of leaving a silent disabled button", async () => {
    render(<ActivateLicenceForm />);
    const { file } = makeFile("  \n");
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect((await screen.findByRole("alert")).textContent).toBe(BAD_FORMAT);
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
});

describe("checking", () => {
  it("Test 3: while inspect is pending the button reads Checking… and the panel is aria-busy", async () => {
    const pending = deferred<unknown>();
    mocks.inspect.mockReturnValue(pending.promise);
    render(<ActivateLicenceForm />);
    paste(RAW);
    const panel = screen.getByTestId("licence-activate-panel");
    expect(panel.getAttribute("aria-busy")).toBe("false");

    fireEvent.click(checkButton());

    await waitFor(() => expect(checkButton().textContent).toBe("Checking…"));
    expect(checkButton().disabled).toBe(true);
    expect(panel.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      pending.resolve({ ok: true, preview: PREVIEW });
    });
    expect(panel.getAttribute("aria-busy")).toBe("false");
  });

  it("Test 4: a verified result renders the preview rows, the two buttons and no pasted text", async () => {
    await reachPreview({
      ...PREVIEW,
      replaces: { licenceId: "LIC-2026-0001", expires: { local: "31 Dec 2026, 23:59 WAT", utc: "2026-12-31T22:59:59Z" } },
    });

    expect(screen.getByRole("heading", { name: "Verified" })).toBeTruthy();
    for (const label of ["Licence ID", "Client", "Deployment", "Issued", "Starts", "Expires", "Grace ends", "Replaces"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("LIC-2026-0002")).toBeTruthy();
    expect(screen.getByText("Fixture Training Academy")).toBeTruthy();
    expect(screen.getByText("Matches this deployment")).toBeTruthy();
    for (const text of [
      "30 Sep 2026, 13:00 WAT",
      "2026-09-30T12:00:00Z",
      "1 Oct 2026, 01:00 WAT",
      "31 Mar 2027, 23:59 WAT",
      "2027-03-31T22:59:59Z",
      "14 Apr 2027, 23:59 WAT",
      "2027-04-14T22:59:59Z",
      "LIC-2026-0001",
      "Expires 31 Dec 2026, 23:59 WAT",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText("Africa/Lagos")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate licence" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a different file" })).toBeTruthy();
    expect(document.body.textContent).not.toContain(RAW);
    expect(document.body.textContent).not.toContain("LMS-LIC1");
  });

  it("Test 4: the Replaces row is absent when nothing is replaced", async () => {
    await reachPreview();
    expect(screen.queryByText("Replaces")).toBeNull();
  });

  it("no verified text is shown before verification: a pending or rejected check shows no preview content", async () => {
    mocks.inspect.mockResolvedValue({
      ok: false,
      code: "BAD_SIGNATURE",
      message: `${rejectionSentence("BAD_SIGNATURE")} Nothing was changed.`,
      neutral: false,
    });
    render(<ActivateLicenceForm />);
    paste(RAW);
    fireEvent.click(checkButton());
    await screen.findByRole("alert");
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByText("Matches this deployment")).toBeNull();
  });

  it("Test 5: a rejection renders in a role alert note with Nothing was changed. and keeps the input", async () => {
    const message = `${rejectionSentence("BAD_SIGNATURE")} Nothing was changed.`;
    mocks.inspect.mockResolvedValue({ ok: false, code: "BAD_SIGNATURE", message, neutral: false });
    render(<ActivateLicenceForm />);
    paste(RAW);
    fireEvent.click(checkButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(alert.textContent).toContain("Nothing was changed.");
    expect(alert.className).toMatch(/border-danger/);
    expect(pasteBox().value).toBe(RAW);
    expect(checkButton().disabled).toBe(false);
    expect(document.activeElement).toBe(alert);
  });

  it("Test 5: ALREADY_ACTIVE renders in a neutral note, not the danger style", async () => {
    mocks.inspect.mockResolvedValue({
      ok: false,
      code: "ALREADY_ACTIVE",
      message: rejectionSentence("ALREADY_ACTIVE"),
      neutral: true,
    });
    render(<ActivateLicenceForm />);
    paste(RAW);
    fireEvent.click(checkButton());

    const note = await screen.findByText(rejectionSentence("ALREADY_ACTIVE"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(note.getAttribute("role")).toBe("status");
    expect(note.className).toMatch(/border-foreground/);
    expect(note.className).not.toMatch(/danger/);
  });

  it("an unexpected failure of the inspect call shows the generic failure copy", async () => {
    mocks.inspect.mockRejectedValue(new Error("network"));
    render(<ActivateLicenceForm />);
    paste(RAW);
    fireEvent.click(checkButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Licence not activated. Nothing was changed. Try again; if it persists, contact support.");
    expect(checkButton().disabled).toBe(false);
  });

  it("Choose a different file resets the panel to the chooser and moves focus to the file control", async () => {
    await reachPreview();
    fireEvent.click(screen.getByRole("button", { name: "Choose a different file" }));
    expect(screen.queryByText("Verified")).toBeNull();
    expect(pasteBox().value).toBe("");
    expect(checkButton().disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(fileInput()));
  });
});

describe("confirming", () => {
  it("Test 6: Activate licence opens the dialog with the title, eyebrow and body, no reason field and the confirm label", async () => {
    await reachPreview();
    const { dialog } = openDialog();

    expect(within(dialog).getByRole("heading", { name: "Activate this licence?" })).toBeTruthy();
    expect(within(dialog).getByText("Audited action")).toBeTruthy();
    expect(dialog.textContent).toContain(
      ACTIVATE_CONFIRM_BODY("LIC-2026-0002", "Fixture Training Academy", "31 Mar 2027, 23:59 WAT"),
    );
    expect(dialog.querySelector("textarea")).toBeNull();
    expect(within(dialog).queryByLabelText(/reason/i)).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Activate licence" })).toBeTruthy();
    // Focus entered the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Test 6: cancel closes the dialog and returns focus to the Activate licence button", async () => {
    await reachPreview();
    const { trigger, dialog } = openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("Test 6: ESC cancels the dialog and focus returns to the trigger", async () => {
    await reachPreview();
    const { trigger } = openDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Test 6: confirm calls activateLicenceAction with the held text, not with any preview field, and ESC is ignored while pending", async () => {
    const pending = deferred<unknown>();
    mocks.activate.mockReturnValue(pending.promise);
    await reachPreview();
    const { dialog } = openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Activate licence" }));

    await waitFor(() => expect(mocks.activate).toHaveBeenCalledTimes(1));
    expect(mocks.activate).toHaveBeenCalledWith({ raw: RAW });
    const sent = mocks.activate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["raw"]);
    expect(JSON.stringify(sent)).not.toContain("LIC-2026-0002");
    expect(JSON.stringify(sent)).not.toContain("Fixture Training Academy");

    // Pending: the confirm shows its working state, Cancel is disabled and ESC does nothing.
    expect(within(dialog).getByRole("button", { name: "Working…" })).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      pending.resolve({ ok: true, message: "Licence activated. This deployment is now Active." });
    });
  });

  it("Test 6: the text sent on confirm is the text that was checked, even for a file source", async () => {
    mocks.inspect.mockResolvedValue({ ok: true, preview: PREVIEW });
    mocks.activate.mockResolvedValue({ ok: false, code: "BAD_SIGNATURE", message: "x", neutral: false });
    render(<ActivateLicenceForm />);
    const { file } = makeFile(`${RAW}\n`);
    await chooseFile(file);
    fireEvent.click(checkButton());
    await screen.findByText("Verified");
    const { dialog } = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate licence" }));
    await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith({ raw: RAW }));
  });

  it("Test 6: a rejection from activate shows in the dialog error slot and keeps the dialog open", async () => {
    const message = `Licence not activated. ${rejectionSentence("WRONG_DEPLOYMENT")}`;
    mocks.activate.mockResolvedValue({ ok: false, code: "WRONG_DEPLOYMENT", message, neutral: false });
    await reachPreview();
    const { dialog } = openDialog();

    fireEvent.click(within(dialog).getByRole("button", { name: "Activate licence" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Action not applied");
    expect(alert.textContent).toContain(message);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Activate licence" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an unexpected failure of the activate call shows the generic failure copy in the dialog", async () => {
    mocks.activate.mockRejectedValue(new Error("network"));
    await reachPreview();
    const { dialog } = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate licence" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Licence not activated. Nothing was changed.");
  });

  it("Test 7: success renders a role status note with the success sentence, focuses it once, and resets the panel", async () => {
    const message = "Licence activated. This deployment is now Active.";
    mocks.activate.mockResolvedValue({ ok: true, message });
    const focused: HTMLElement[] = [];
    const original = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, ...args) {
      focused.push(this);
      return original.apply(this, args);
    });

    await reachPreview();
    const { dialog } = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate licence" }));

    const note = await screen.findByRole("status");
    expect(note.textContent).toBe(message);
    expect(note.className).toMatch(/border-success/);
    expect(document.activeElement).toBe(note);
    expect(screen.queryByRole("dialog")).toBeNull();

    // The panel reset: back to the chooser with no preview and no held text.
    expect(screen.queryByText("Verified")).toBeNull();
    expect(pasteBox().value).toBe("");
    expect(checkButton().disabled).toBe(true);

    // Focus moved to the note exactly once, and an unrelated re-render does not move it again.
    expect(focused.filter((element) => element === note)).toHaveLength(1);
    paste("");
    expect(focused.filter((element) => element === note)).toHaveLength(1);
  });
});

describe("LIC-03: no create, edit or replace control", () => {
  it("Test 8: no control has an accessible name matching create, extend, edit, replace or reactivate in any stage", async () => {
    const names = () =>
      [
        ...screen.queryAllByRole("button").map((el) => el.textContent ?? ""),
        ...screen.queryAllByRole("textbox").map((el) => el.getAttribute("aria-label") ?? el.id),
        ...screen.queryAllByRole("link").map((el) => el.textContent ?? ""),
      ].concat(Array.from(document.querySelectorAll("label")).map((el) => el.textContent ?? ""));

    mocks.inspect.mockResolvedValue({ ok: true, preview: PREVIEW });
    render(<ActivateLicenceForm />);
    for (const name of names()) expect(name).not.toMatch(FORBIDDEN_NAME);
    expect(screen.queryAllByRole("link")).toHaveLength(0);

    paste(RAW);
    fireEvent.click(checkButton());
    await screen.findByText("Verified");
    for (const name of names()) expect(name).not.toMatch(FORBIDDEN_NAME);

    openDialog();
    for (const name of names()) expect(name).not.toMatch(FORBIDDEN_NAME);

    // The only write control is the confirmation of a provider-issued file.
    const buttonNames = screen.getAllByRole("button").map((el) => el.textContent);
    expect(buttonNames.every((name) => ["Activate licence", "Choose a different file", "Cancel"].includes(name ?? ""))).toBe(
      true,
    );
  });
});
