/**
 * CourseDetailActions transport-failure recovery (WR-06, CR-07, T-04.1-G18).
 *
 * Every imperative async action on the course detail bar — listing, publish,
 * unpublish, archive, un-archive — must survive an *unexpected* rejection
 * from its Server Action:
 *
 *   1. The busy state clears (via `finally`) so the control is never stranded
 *      disabled.
 *   2. A generic, retryable message is shown — no raw server exception, and
 *      never a claim of success.
 *   3. The dialog / typed reason / ticked cohorts stay put, and a
 *      user-initiated retry then succeeds. The mutation is never auto-repeated.
 *
 * `publish-actions.ts` is a real "use server" module; it is mocked here, the
 * same reasoning `cohort-detail-actions.test.tsx` documents.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReadinessItem } from "@/server/services/readiness-service";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/staff/courses/[id]/publish-actions", () => ({
  publishCourseAction: vi.fn(),
  unpublishCourseAction: vi.fn(),
  archiveCourseAction: vi.fn(),
  unarchiveCourseAction: vi.fn(),
  setListingAction: vi.fn(),
}));

import {
  publishCourseAction,
  unpublishCourseAction,
  archiveCourseAction,
  setListingAction,
} from "@/app/staff/courses/[id]/publish-actions";
import { CourseDetailActions } from "@/components/catalogue/CourseDetailActions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const readyItems = (): ReadinessItem[] => [
  { id: "content", category: "Content", label: "Content present", state: "PASS", blocking: true },
  { id: "price", category: "Price", label: "Price set", state: "PASS", blocking: true },
];

function renderActions(overrides: Partial<Parameters<typeof CourseDetailActions>[0]> = {}) {
  return render(
    <CourseDetailActions
      courseId="course-1"
      status="DRAFT"
      publiclyListed={false}
      canPublishContent
      canManageListing
      expectedUpdatedAt="2026-01-01T00:00:00.000Z"
      readinessItems={readyItems()}
      unpublishedChanges={["Summary changed"]}
      affectedCohorts={[]}
      {...overrides}
    />,
  );
}

describe("CourseDetailActions — listing transport failure", () => {
  it("clears busy and shows a generic retryable error when setListingAction rejects, then a retry succeeds", async () => {
    vi.mocked(setListingAction)
      .mockRejectedValueOnce(new Error("ECONNRESET at db.pool.acquire"))
      .mockResolvedValueOnce({ ok: true });

    renderActions();
    const listBtn = screen.getByRole("button", { name: "List publicly" });
    fireEvent.click(listBtn);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/was not applied/i);
    expect(alert.textContent).not.toMatch(/ECONNRESET/);

    const retryBtn = screen.getByRole("button", { name: "List publicly" });
    expect((retryBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(retryBtn);
    await screen.findByText(/now publicly listed/i);
    expect(setListingAction).toHaveBeenCalledTimes(2);
  });
});

describe("CourseDetailActions — publish transport failure", () => {
  it("keeps the publish dialog open with a generic error on rejection, never claims success, and a retry then publishes", async () => {
    vi.mocked(publishCourseAction)
      .mockRejectedValueOnce(new Error("500 upstream"))
      .mockResolvedValueOnce({ ok: true, version: 2, migratedCohortIds: [] });

    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Publish content" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    const alert = await within(dialog).findByText(/was not published/i);
    expect(alert.textContent).not.toMatch(/500 upstream/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText(/Course published/i)).toBeNull();

    const publishBtn = within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" });
    expect((publishBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(publishBtn);

    await screen.findByText(/Course published/i);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(publishCourseAction).toHaveBeenCalledTimes(2);
  });
});

describe("CourseDetailActions — reasoned action transport failure", () => {
  it("keeps the archive modal and typed reason on rejection, clears busy, and a retry succeeds without re-calling on the failed attempt's own click", async () => {
    vi.mocked(archiveCourseAction)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, programmeWarnings: [] });

    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/i }), {
      target: { value: "Course retired for 2026 intake" },
    });
    const confirm = within(dialog).getByRole("button", { name: "Archive course" });
    fireEvent.click(confirm);

    const alert = await within(dialog).findByText(/was not applied/i);
    expect(alert.textContent).not.toMatch(/network down/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: /Reason/i }) as HTMLTextAreaElement).value).toBe(
      "Course retired for 2026 intake",
    );

    const retry = within(screen.getByRole("dialog")).getByRole("button", { name: "Archive course" });
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(retry);

    await screen.findByText(/archived and removed/i);
    expect(archiveCourseAction).toHaveBeenCalledTimes(2);
  });

  it("also recovers an unpublish rejection through the modal error slot", async () => {
    vi.mocked(unpublishCourseAction).mockRejectedValueOnce(new Error("boom"));

    renderActions({ status: "PUBLISHED" });
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/i }), {
      target: { value: "Pulling content for a fix" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish" }));

    const alert = await within(dialog).findByText(/was not applied/i);
    expect(alert.textContent).not.toMatch(/boom/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
