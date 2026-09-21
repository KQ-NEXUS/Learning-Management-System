/**
 * Plan 11-09: the certificate-template library list and the editor's chrome.
 *
 * Lives under tests/components/ — vitest.config.mts's "components" jsdom
 * project only picks up tests/components/**\/*.test.tsx (11-08's own
 * precedent, certificate-settings-form.test.tsx).
 *
 * Covers:
 *
 *   1. `TemplatesTable` — the Default pill renders on exactly one row and
 *      is absent (not an empty cell) elsewhere; an archived row exposes a
 *      "View" link and no Edit/Archive/Set-as-default control; the empty
 *      state renders UI-SPEC's exact two copy strings.
 *   2. `TemplateEditorShell` — "Save template" is disabled until something
 *      changes; the empty-canvas and empty-inspector prompts render their
 *      exact copy; read-only mode renders no palette and no save button;
 *      and a click-to-add text element genuinely round-trips through the
 *      real `certificateTemplateService` (an in-memory-delegate instance,
 *      not the live Prisma-backed singleton) — proving the element list is
 *      real state, not a placeholder.
 *
 * `ResourceTable` renders both a `<table>` (>=640px) and a `<ul>` card list
 * (<640px) in the DOM at once — jsdom computes no media queries — so every
 * assertion below that would otherwise see duplicate text is scoped with
 * `within(screen.getByRole("table"))`, matching `courses-table.test.tsx`'s
 * own precedent.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TemplatesTable, type TemplateRow } from "@/app/staff/certificates/templates/TemplatesTable";
import { TemplateEditorShell } from "@/app/staff/certificates/templates/TemplateEditorShell";
import { EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import {
  createCertificateTemplateService,
  type CertificateTemplateRecord,
  type CertificateTemplateTx,
} from "@/server/services/certificate-template-service";
import { type Delegate } from "@/server/services/resource-service";
import { createTestWithPermission, grant } from "../support/harness";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function makeRow(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: "tpl-1",
    name: "Standard",
    isDefault: false,
    archivedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("TemplatesTable", () => {
  it("renders the Default pill on exactly one row and no pill on the others", () => {
    render(
      <TemplatesTable
        rows={[
          makeRow({ id: "tpl-1", name: "Standard", isDefault: true }),
          makeRow({ id: "tpl-2", name: "Alt", isDefault: false }),
          makeRow({ id: "tpl-3", name: "Another", isDefault: false }),
        ]}
      />,
    );

    const table = within(screen.getByRole("table"));
    // The "Default" column HEADER also matches this text — scope to cell
    // (<td>) matches only, excluding the <th>.
    const pillMatches = table.getAllByText("Default").filter((el) => el.closest("td"));
    expect(pillMatches).toHaveLength(1);
  });

  it("gives an archived row a View link and no Edit, Set as default or Archive control", () => {
    render(
      <TemplatesTable
        rows={[
          makeRow({ id: "tpl-1", name: "Standard" }),
          makeRow({ id: "tpl-2", name: "Old template", archivedAt: new Date("2026-02-01T00:00:00.000Z") }),
        ]}
      />,
    );

    const table = within(screen.getByRole("table"));
    const archivedRow = table.getByText("Old template").closest("tr") as HTMLElement;
    const liveRow = table.getByText("Standard").closest("tr") as HTMLElement;

    expect(within(archivedRow).getByRole("link", { name: "View" })).toBeTruthy();
    expect(within(archivedRow).queryByRole("link", { name: "Edit" })).toBeNull();
    expect(within(archivedRow).queryByText("Set as default")).toBeNull();
    expect(within(archivedRow).queryByText("Archive")).toBeNull();

    expect(within(liveRow).getByRole("link", { name: "Edit" })).toBeTruthy();
    expect(within(liveRow).getByText("Set as default")).toBeTruthy();
    expect(within(liveRow).getByText("Archive")).toBeTruthy();
  });

  it("renders the exact empty-state copy", () => {
    render(<TemplatesTable rows={[]} />);

    expect(screen.getByText("No templates yet")).toBeTruthy();
    expect(screen.getByText("Create a template to define how issued certificates look.")).toBeTruthy();
  });

  it("calls onArchive with the confirmed reason when a live row is archived", async () => {
    const onArchive = vi.fn().mockResolvedValue({ ok: true });
    render(
      <TemplatesTable
        rows={[makeRow({ id: "tpl-1", name: "Standard" })]}
        onArchive={onArchive}
      />,
    );

    fireEvent.click(screen.getAllByText("Archive")[0]);
    fireEvent.change(screen.getByLabelText(/^Reason for archiving/), {
      target: { value: "No longer in use by any offering." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive template" }));

    await waitFor(() =>
      expect(onArchive).toHaveBeenCalledWith({
        id: "tpl-1",
        reason: "No longer in use by any offering.",
      }),
    );
  });
});

describe("TemplateEditorShell", () => {
  it("renders the empty-canvas and empty-inspector prompts with exact UI-SPEC copy", () => {
    render(<TemplateEditorShell initial={{ name: "", layout: EMPTY_LAYOUT_V1, readOnly: false }} />);

    expect(screen.getByText("Add an element to begin designing this certificate.")).toBeTruthy();
    expect(screen.getAllByText("Select an element to edit its properties.").length).toBeGreaterThan(0);
  });

  it("keeps Save template disabled until something changes, then enables it", () => {
    render(
      <TemplateEditorShell
        initial={{ id: "tpl-1", name: "Existing template", layout: EMPTY_LAYOUT_V1, readOnly: false }}
      />,
    );

    const save = screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Existing template v2" } });

    expect(save.disabled).toBe(false);
  });

  it("renders no palette and no save button in read-only mode", () => {
    render(
      <TemplateEditorShell
        initial={{ id: "tpl-1", name: "Archived template", layout: EMPTY_LAYOUT_V1, readOnly: true }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save template" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Text" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Image" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Border" })).toHaveLength(0);
  });

  it("round-trips a click-to-add text element through the real service, at its default position", async () => {
    const initialRow: CertificateTemplateRecord = {
      id: "tpl-1",
      name: "Draft template",
      layout: EMPTY_LAYOUT_V1,
      layoutSchemaVersion: 1,
      isDefault: false,
      archivedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const rows = new Map<string, CertificateTemplateRecord>([[initialRow.id, initialRow]]);
    const delegate: Delegate<CertificateTemplateRecord> = {
      findMany: vi.fn(async () => [...rows.values()]),
      findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
      create: vi.fn(async () => {
        throw new Error("create is not exercised by this round-trip test");
      }),
      update: vi.fn(async ({ where, data }) => {
        const existing = rows.get(where.id);
        if (!existing) throw new Error("not found");
        const next = { ...existing, ...(data as Partial<CertificateTemplateRecord>) };
        rows.set(where.id, next);
        return next;
      }),
    };
    const { withPermission } = createTestWithPermission([
      grant("certificates.view"),
      grant("certificates.manage"),
    ]);
    const { certificateTemplateService } = createCertificateTemplateService({
      delegate,
      db: { $transaction: async (fn) => fn({} as CertificateTemplateTx) },
      withPermission,
      audit: async () => {},
    });

    const onSave = async (input: { id: string; name: string; layout: unknown }) => {
      try {
        await certificateTemplateService.update(input.id, { name: input.name, layout: input.layout });
        return { ok: true as const };
      } catch {
        return { ok: false as const, message: "save failed" };
      }
    };

    render(
      <TemplateEditorShell
        initial={{ id: "tpl-1", name: "Draft template", layout: EMPTY_LAYOUT_V1, readOnly: false }}
        onSave={onSave}
      />,
    );

    // Text/Image/Border palette entries render twice (a sub-lg `<details>`
    // disclosure and an lg+ `<aside>`) since jsdom computes no breakpoints —
    // either copy adds the same element to the one shared state.
    fireEvent.click(screen.getAllByRole("button", { name: "Text" })[0]);

    const save = screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(async () => {
      const reloaded = await certificateTemplateService.get("tpl-1");
      const layout = reloaded?.layout as { elements: Array<Record<string, unknown>> };
      expect(layout.elements).toHaveLength(1);
      expect(layout.elements[0]).toMatchObject({
        kind: "text",
        field: "literal",
        literal: "New text",
        // EMPTY_LAYOUT_V1 is A4/landscape (842 x 595pt) — canvas centre
        // minus the default 200x40 text box's own half-width/half-height.
        x: 321,
        y: 278,
        width: 200,
        height: 40,
      });
    });
  });
});
