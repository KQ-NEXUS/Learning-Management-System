/**
 * Shared branded email layout (D-13). One 600px, table-based, inline-styled
 * layout every template renders through, plus the derived plain-text
 * alternative. Email clients cannot use CSS variables, so the palette is one
 * constants object of literal hex values copied from the UI-SPEC primitives.
 *
 * Every interpolated string passes through `escapeHtml` (T-13-06).
 */

export const EMAIL_COLORS = {
  pageBackground: "#f3f5f9",
  card: "#ffffff",
  text: "#0f1730",
  textSecondary: "#5b6478",
  button: "#2d4bff",
  buttonText: "#ffffff",
  hairline: "#e3e7f1",
  headerBand: "#0a1024",
  headerBrandText: "#ffffff",
} as const;

export type EmailContent = {
  /** Raw subject; `renderEmail` sanitises it. */
  subject: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; href: string };
};

export type EmailLayoutContext = {
  brandName: string;
  supportEmail: string;
};

export const EMAIL_FOOTER_REASON =
  "You are receiving this because of activity on your account.";

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function escapeHtml(value: string): string {
  return String(value)
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderEmailLayout(
  content: EmailContent,
  context: EmailLayoutContext,
): { html: string; text: string } {
  const c = EMAIL_COLORS;
  const brand = escapeHtml(context.brandName);
  const support = escapeHtml(context.supportEmail);

  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:24px;color:${c.text};">${escapeHtml(p)}</p>`,
    )
    .join("");

  const button = content.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td align="center" bgcolor="${c.button}" style="background-color:${c.button};border-radius:6px;"><a href="${escapeHtml(content.button.href)}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 24px;font-family:${FONT};font-size:16px;font-weight:600;color:${c.buttonText};text-decoration:none;border-radius:6px;">${escapeHtml(content.button.label)}</a></td></tr></table>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;padding:0;background-color:${c.pageBackground};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${c.pageBackground};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="background-color:${c.headerBand};padding:20px 24px;font-family:${FONT};font-size:18px;font-weight:600;color:${c.headerBrandText};">${brand}</td></tr>
<tr><td style="background-color:${c.card};padding:32px 24px;">
<h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:600;color:${c.text};">${escapeHtml(content.heading)}</h1>
${paragraphs}${button}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${c.hairline};font-family:${FONT};font-size:14px;line-height:20px;color:${c.textSecondary};">
<p style="margin:0 0 8px 0;">${brand}. Questions? Contact us at <a href="mailto:${support}" style="color:${c.button};">${support}</a>.</p>
<p style="margin:0;">${escapeHtml(EMAIL_FOOTER_REASON)}</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const lines: string[] = [content.heading, ""];
  for (const p of content.paragraphs) {
    lines.push(p, "");
  }
  if (content.button) {
    lines.push(`${content.button.label}:`, content.button.href, "");
  }
  lines.push(`${context.brandName}. Questions? Contact us at ${context.supportEmail}.`);
  lines.push(EMAIL_FOOTER_REASON);

  return { html, text: lines.join("\n") };
}
