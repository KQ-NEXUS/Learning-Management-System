/**
 * Browser-side direct-upload orchestration for one ticket file:
 * intent -> presigned PUT -> complete. Never throws; failures are returned so
 * the caller can mark just that file as retryable.
 */
export type UploadOutcome = { ok: true } | { ok: false; message: string };

export async function uploadTicketAttachment(messageId: string, file: File): Promise<UploadOutcome> {
  try {
    const intent = await fetch("/api/ticket-attachments/upload-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messageId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    });
    if (!intent.ok) {
      const detail = intent.status === 422 ? ((await intent.json().catch(() => null)) as { error?: string } | null)?.error : null;
      return { ok: false, message: detail ?? "The file could not be prepared for upload." };
    }
    const { attachment, upload } = (await intent.json()) as {
      attachment: { id: string };
      upload: { url: string; method: "PUT"; headers: Record<string, string> };
    };
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: file });
    if (!put.ok) return { ok: false, message: "The file could not be uploaded." };
    const done = await fetch("/api/ticket-attachments/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attachmentId: attachment.id }),
    });
    if (!done.ok) return { ok: false, message: "The uploaded file could not be verified." };
    return { ok: true };
  } catch {
    return { ok: false, message: "The file could not be uploaded." };
  }
}
