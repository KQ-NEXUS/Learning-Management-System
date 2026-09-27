/**
 * Step 3 of a private ticket-file upload: verifies the stored object against
 * the intent and marks the attachment READY. Denials are an empty 404; a
 * metadata mismatch is 409 with a generic message.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeTicketAttachmentUpload,
  TicketAttachmentConflictError,
  TicketAttachmentNotFoundError,
} from "@/server/services/ticket-attachment-service";

const schema = z.object({ attachmentId: z.string().min(1).max(100) });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing attachment id." }, { status: 400 });
  }

  try {
    const attachment = await completeTicketAttachmentUpload(parsed.data.attachmentId);
    return NextResponse.json(
      { attachment },
      { status: 200, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof TicketAttachmentNotFoundError) return new NextResponse(null, { status: 404 });
    if (err instanceof TicketAttachmentConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
