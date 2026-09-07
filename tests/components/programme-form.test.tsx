import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ProgrammeForm } from "@/app/staff/programmes/ProgrammeForm";
import {
  createProgrammeAction,
  updateProgrammeAction,
} from "@/app/staff/programmes/actions";

// The form imports a "use server" module; mock it so the server chain never
// loads under jsdom and so the exact FormData payload can be inspected.
vi.mock("@/app/staff/programmes/actions", () => ({
  createProgrammeAction: vi.fn(),
  updateProgrammeAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const createAction = vi.mocked(createProgrammeAction);
const updateAction = vi.mocked(updateProgrammeAction);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
}

function lastFormData(mockFn: typeof createAction | typeof updateAction): FormData {
  const call = mockFn.mock.calls.at(-1);
  if (!call) throw new Error("the server action was never invoked");
  return call[1] as FormData;
}

describe("ProgrammeForm — outcomes on create", () => {
  it("submits the existing multiline outcomes field verbatim", async () => {
    createAction.mockResolvedValue({ ok: true, id: "prog-1" });
    const { container } = render(<ProgrammeForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Operational Leadership" },
    });
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "operational-leadership" },
    });

    const outcomes =
      "Lead a shift safely.\nEscalate within policy.\nBrief the incoming team.";
    const field = screen.getByLabelText("Outcomes");
    expect(field.tagName).toBe("TEXTAREA");
    fireEvent.change(field, { target: { value: outcomes } });

    submit(container);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(lastFormData(createAction).get("outcomes")).toBe(outcomes);
  });

  it("still sends the outcomes key when the optional field is left empty", async () => {
    createAction.mockResolvedValue({ ok: true, id: "prog-1" });
    const { container } = render(<ProgrammeForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Ops" } });
    fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: "ops" } });
    submit(container);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    const fd = lastFormData(createAction);
    expect(fd.has("outcomes")).toBe(true);
    expect(fd.get("outcomes")).toBe("");
  });

  it("associates a server validation error for outcomes with the field", async () => {
    createAction.mockResolvedValue({
      ok: false,
      errors: [
        { name: "outcomes", message: "Keep outcomes to 4000 characters or fewer." },
      ],
      message: null,
    });
    const { container } = render(<ProgrammeForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Ops" } });
    fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: "ops" } });
    submit(container);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    const field = await screen.findByLabelText("Outcomes");
    await waitFor(() =>
      expect(field.getAttribute("aria-invalid")).toBe("true"),
    );
    const describedBy = field.getAttribute("aria-describedby") ?? "";
    const messageNode = describedBy
      .split(" ")
      .map((id) => document.getElementById(id))
      .find((node) => node?.textContent?.includes("4000 characters"));
    expect(messageNode).toBeTruthy();
  });
});

describe("ProgrammeForm — outcomes persistence through edits and failed saves", () => {
  const editValues = {
    title: "Ops",
    slug: "ops",
    outcomes: "Existing outcome one.\nExisting outcome two.",
    audience: "Shift leads",
    sequential: true,
  };

  it("renders the stored outcomes text as the edit default", () => {
    render(
      <ProgrammeForm mode="edit" programmeId="prog-1" values={editValues} />,
    );
    expect(
      (screen.getByLabelText("Outcomes") as HTMLTextAreaElement).value,
    ).toBe("Existing outcome one.\nExisting outcome two.");
  });

  it("keeps the existing outcomes text when an unrelated field is edited", () => {
    render(
      <ProgrammeForm mode="edit" programmeId="prog-1" values={editValues} />,
    );
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Ops Renamed" },
    });
    fireEvent.change(screen.getByLabelText("Audience"), {
      target: { value: "New joiners" },
    });
    expect(
      (screen.getByLabelText("Outcomes") as HTMLTextAreaElement).value,
    ).toBe("Existing outcome one.\nExisting outcome two.");
  });

  it("retains attempted outcomes text after a failed save and shows no success message", async () => {
    updateAction.mockResolvedValue({
      ok: false,
      errors: [{ name: "slug", message: "Enter a slug." }],
      message: null,
    });
    const { container } = render(
      <ProgrammeForm mode="edit" programmeId="prog-1" values={editValues} />,
    );

    const field = screen.getByLabelText("Outcomes") as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Rewritten outcome text." } });
    submit(container);

    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Enter a slug." })).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText("Outcomes") as HTMLTextAreaElement).value,
    ).toBe("Rewritten outcome text.");
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("submits an edited outcomes value and caps the control at the 4000-character action limit", async () => {
    updateAction.mockResolvedValue({ ok: true, id: "prog-1" });
    const { container } = render(
      <ProgrammeForm mode="edit" programmeId="prog-1" values={editValues} />,
    );

    const field = screen.getByLabelText("Outcomes") as HTMLTextAreaElement;
    expect(field.getAttribute("maxlength")).toBe("4000");
    fireEvent.change(field, { target: { value: "Updated outcome." } });
    submit(container);

    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
    expect(lastFormData(updateAction).get("outcomes")).toBe("Updated outcome.");
  });
});
