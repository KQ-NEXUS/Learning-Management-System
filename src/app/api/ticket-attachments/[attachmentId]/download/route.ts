/**
 * Authorized download of one READY ticket attachment. Authorization happens in
 * the service before anything is presigned. Missing, unauthorized, internal
 * (for learners) and non-READY attachments all return the identical empty 404.
 * The redirect target is a short-lived private URL forced to `attachment`.
 */

import { NextResponse } from "next/server";
import {
  getTicketAttachmentDownload,
  TicketAttachmentNotFoundError,
} from "@/server/services/ticket-attachment-service";
import { presignLessonObjectUrl } from "@/server/services/storage-service";

const notFound = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const { attachmentId } = await ctx.params;

  try {
    const file = await getTicketAttachmentDownload(attachmentId);
    const url = await presignLessonObjectUrl({
      key: file.storageKey,
      lessonType: "FILE",
      filename: file.filename,
      contentType: file.mimeType,
    });
    return new NextResponse(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof TicketAttachmentNotFoundError) return notFound();
    throw err;
  }
}
