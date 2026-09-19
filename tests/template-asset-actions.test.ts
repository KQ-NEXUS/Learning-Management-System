import { beforeEach, describe, expect, it, vi } from "vitest";

// CR-02: certificate template assets are restricted to PNG and JPEG at both
// presign (client-claimed type, courtesy) and confirm (server-OBSERVED type,
// the real gate — T-11-11 / T-11-119), because the renderer embeds only those.

const storage = vi.hoisted(() => ({
  buildStagedTemplateAssetStorageKey: vi.fn(),
  finalTemplateAssetKeyFor: vi.fn(),
  presignTemplateAssetUploadUrl: vi.fn(),
  inspectLessonObject: vi.fn(),
  promoteLessonObject: vi.fn(),
  deleteLessonObject: vi.fn(),
}));

vi.mock("@/server/services/storage-service", () => storage);

vi.mock("@/server/permissions", () => {
  class AuthenticationError extends Error {}
  class AuthorizationError extends Error {}
  return {
    AuthenticationError,
    AuthorizationError,
    // Authorized caller: run the wrapped function straight through.
    withPermission: () => (fn: (input: unknown) => Promise<unknown>) => (input: unknown) => fn(input),
  };
});

import {
  confirmTemplateAssetUploadAction,
  presignTemplateAssetUploadAction,
} from "@/app/staff/certificates/templates/template-asset-actions";

const STAGED_KEY = "certificate-template-asset-uploads/tpl-1/opaque";
const FINAL_KEY = "certificate-template-assets/tpl-1/opaque";

beforeEach(() => {
  vi.clearAllMocks();
  storage.buildStagedTemplateAssetStorageKey.mockReturnValue(STAGED_KEY);
  storage.finalTemplateAssetKeyFor.mockReturnValue(FINAL_KEY);
  storage.presignTemplateAssetUploadUrl.mockResolvedValue("https://storage.example/put");
  storage.promoteLessonObject.mockResolvedValue(undefined);
  storage.deleteLessonObject.mockResolvedValue(undefined);
});

function presignInput(mimeType: string) {
  return { templateId: "tpl-1", filename: "logo", mimeType, sizeBytes: 1_000 };
}

describe("presignTemplateAssetUploadAction — PNG/JPEG only", () => {
  it.each(["image/webp", "image/gif"])("rejects %s without presigning", async (mimeType) => {
    const result = await presignTemplateAssetUploadAction(presignInput(mimeType));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/PNG/);
      expect(result.message).toMatch(/JPEG/);
    }
    expect(storage.presignTemplateAssetUploadUrl).not.toHaveBeenCalled();
  });

  it.each(["image/png", "image/jpeg"])("presigns %s", async (mimeType) => {
    const result = await presignTemplateAssetUploadAction(presignInput(mimeType));

    expect(result).toMatchObject({ ok: true, stagedKey: STAGED_KEY, uploadUrl: "https://storage.example/put" });
    expect(storage.presignTemplateAssetUploadUrl).toHaveBeenCalledTimes(1);
  });
});

describe("confirmTemplateAssetUploadAction — server-observed type is the gate", () => {
  function confirmInput(contentType: string) {
    return { stagedKey: STAGED_KEY, contentType, sizeBytes: 1_000 };
  }

  it.each(["image/webp", "image/gif"])(
    "rejects an inspected %s (declared and observed match), deletes the staged object and never promotes",
    async (contentType) => {
      storage.inspectLessonObject.mockResolvedValue({ sizeBytes: BigInt(1000), contentType });

      const result = await confirmTemplateAssetUploadAction(confirmInput(contentType));

      expect(result).toEqual({
        ok: false,
        message: "This image could not be verified. Choose a PNG or JPEG under 10 MB and try again.",
      });
      expect(storage.deleteLessonObject).toHaveBeenCalledWith(STAGED_KEY);
      expect(storage.promoteLessonObject).not.toHaveBeenCalled();
    },
  );

  it.each(["image/png", "image/jpeg"])("promotes an inspected %s and returns the final key", async (contentType) => {
    storage.inspectLessonObject.mockResolvedValue({ sizeBytes: BigInt(1000), contentType });

    const result = await confirmTemplateAssetUploadAction(confirmInput(contentType));

    expect(result).toEqual({ ok: true, assetKey: FINAL_KEY });
    expect(storage.promoteLessonObject).toHaveBeenCalledWith({ stagedKey: STAGED_KEY, finalKey: FINAL_KEY });
  });

  it("rejects when the observed type differs from the declared one (spoofed presign type)", async () => {
    storage.inspectLessonObject.mockResolvedValue({ sizeBytes: BigInt(1000), contentType: "image/webp" });

    const result = await confirmTemplateAssetUploadAction(confirmInput("image/png"));

    expect(result.ok).toBe(false);
    expect(storage.promoteLessonObject).not.toHaveBeenCalled();
  });
});
