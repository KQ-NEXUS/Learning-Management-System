/**
 * ProgrammeDetailClient transport-failure recovery (WR-06, CR-07, T-04.1-G18).
 *
 * The programme mirror of `CourseDetailActions`: every imperative mutation
 * (listing, publish, unpublish, archive, un-archive) must recover from an
 * unexpected Server Action rejection —
 *
 *   1. busy key clears in `finally`, so no control stays stuck disabled;
 *   2. a generic retryable message shows, never a raw exception or a false
 *      success;
 *   3. the dialog / modal / typed reason survive, and a user-initiated retry
 *      then succeeds — the mutation is never automatically repeated.
 *
 * `publish-actions.ts` is a real "use server" module, mocked here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReadinessItem } from "@/server/services/readiness-service";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/staff/programmes/[id]/publish-actions", () => ({
  publishProgrammeAction: vi.fn(),
  unpublishProgrammeAction: vi.fn(),
  archiveProgrammeAction: vi.fn(),
  unarchiveProgrammeAction: vi.fn(),
  setProgrammeListingAction: vi.fn(),
}));

import {
  publishProgrammeAction,
  archiveProgrammeAction,
  unpublishProgrammeAction,
  setProgrammeListingAction,
} from "@/app/staff/programmes/[id]/publish-actions";
import { ProgrammeDetailClient } from "@/app/staff/programmes/[id]/ProgrammeDetailClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const readyItems = (): ReadinessItem[] => [
  { id: "content", category: "Content", label: "Content present", state: "PASS", blocking: true },
];

function renderClient(overrides: Partial<Parameters<typeof ProgrammeDetailClient>[0]> = {}) {
  return render(
    <ProgrammeDetailClient
      programmeId="prog-1"
      status="DRAFT"
      publiclyListed={false}
      canPublish
      canManage
      expectedUpdatedAt="2026-01-01T00:00:00.000Z"
      readinessItems={readyItems()}
      unpublishedChanges={["Outline changed"]}
      affectedCohorts={[]}
      {...overrides}
    />,
  );
}

describe("ProgrammeDetailClient — listing transport failure", () => {
  it("clears busy and shows a generic retryable error on rejection, then a retry succeeds", async () => {
    vi.mocked(setProgrammeListingAction)
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce({ ok: true });

    renderClient();
    fireEvent.click(screen.getByRole("button", { name: "List publicly" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/was not applied/i);
    expect(alert.textContent).not.toMatch(/socket hang up/);

    const retry = screen.getByRole("button", { name: "List publicly" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);

    await screen.findByText(/now publicly listed/i);
    expect(setProgrammeListingAction).toHaveBeenCalledTimes(2);
  });
});

describe("ProgrammeDetailClient — publish transport failure", () => {
  it("keeps the dialog open with a generic error, never claims success, and a retry publishes", async () => {
    vi.mocked(publishProgrammeAction)
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ ok: true, version: 3, migratedCohortIds: [] });

    renderClient();
    fireEvent.click(screen.getByRole("button", { name: "Publish content" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    const err = await within(dialog).findByText(/was not published/i);
    expect(err.textContent).not.toMatch(/503/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText(/Programme published/i)).toBeNull();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    await screen.findByText(/Programme published/i);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(publishProgrammeAction).toHaveBeenCalledTimes(2);
  });
});

describe("ProgrammeDetailClient — reasoned action transport failure", () => {
  it("keeps the archive modal and typed reason on rejection, clears busy, and a retry succeeds", async () => {
    vi.mocked(archiveProgrammeAction)
      .mockRejectedValueOnce(new Error("db offline"))
      .mockResolvedValueOnce({ ok: true });

    renderClient();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/i }), {
      target: { value: "Programme retired this cycle" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive programme" }));

    const err = await within(dialog).findByText(/was not applied/i);
    expect(err.textContent).not.toMatch(/db offline/);
    expect(
      (within(dialog).getByRole("textbox", { name: /Reason/i }) as HTMLTextAreaElement).value,
    ).toBe("Programme retired this cycle");

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive programme" }));
    await screen.findByText(/archived and removed/i);
    expect(archiveProgrammeAction).toHaveBeenCalledTimes(2);
  });

  it("also recovers an unpublish rejection through the modal error slot", async () => {
    vi.mocked(unpublishProgrammeAction).mockRejectedValueOnce(new Error("kaboom"));

    renderClient({ status: "PUBLISHED" });
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/i }), {
      target: { value: "Pulling programme content" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish" }));

    const err = await within(dialog).findByText(/was not applied/i);
    expect(err.textContent).not.toMatch(/kaboom/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
