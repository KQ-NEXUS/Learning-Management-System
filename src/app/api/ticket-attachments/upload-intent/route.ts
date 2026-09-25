/**
 * Step 1 of a private ticket-file upload. Accepts JSON metadata only; the
 * attachment service authorizes, validates and returns a short-lived presigned
 * PUT. Denials (including learner requests against internal messages) are an
 * empty 404; file-rule failures are 422.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTicketAttachmentUploadIntent,
  TicketAttachmentNotFoundError,
  TicketAttachmentValidationError,
} from "@/server/services/ticket-attachment-service";

const schema = z.object({
  messageId: z.string().min(1).max(100),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or malformed upload metadata." }, { status: 400 });
  }

  try {
    const result = await createTicketAttachmentUploadIntent(parsed.data);
    return NextResponse.json(result, {
      status: 201,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof TicketAttachmentNotFoundError) return new NextResponse(null, { status: 404 });
    if (err instanceof TicketAttachmentValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
