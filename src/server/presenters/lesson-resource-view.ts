/**
 * The browser-safe shape of a lesson resource.
 *
 * `storageKey`, `uploadedById`, `uploadedAt` and `createdAt` are deliberately
 * absent: the object key is a capability and the rest are staff-audit detail.
 * `sizeBytes` is a string so a 2 GB video never rides the wire as a JSON
 * number that loses precision.
 */

import type { LessonResourceRecord } from "@/server/services/lesson-resource-service";

export type LessonResourceView = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  uploadStatus: LessonResourceRecord["uploadStatus"];
  uploadDetail: string | null;
  position: number;
};

export function toLessonResourceView(resource: LessonResourceRecord): LessonResourceView {
  return {
    id: resource.id,
    title: resource.title,
    filename: resource.filename,
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes.toString(),
    uploadStatus: resource.uploadStatus,
    uploadDetail: resource.uploadDetail,
    position: resource.position,
  };
}
