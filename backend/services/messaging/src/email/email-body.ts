import { htmlToText, looksLikeHtml } from '../templates/html-text';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Plain text → the HTML part of a mail: paragraphs on blank lines, `<br>` on
 * single ones, everything escaped. What the composer's plain-text body and a
 * `text`-only template become before SES sees them.
 */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
  return paragraphs.join('\n');
}

/** Both renderings of one body: the HTML the mail carries and the text alternative. */
export function emailBodies(raw: string): { html: string; text: string } {
  const trimmed = raw.trim();
  if (looksLikeHtml(trimmed)) return { html: trimmed, text: htmlToText(trimmed) };
  return { html: textToHtml(trimmed), text: trimmed };
}

export interface AttachmentLink {
  fileName: string;
  url: string;
  size?: number;
}

const humanSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return ` (${bytes} B)`;
  if (bytes < 1024 * 1024) return ` (${Math.round(bytes / 1024)} KB)`;
  return ` (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
};

/** The "Attachments" footer appended when files ride as presigned links rather than MIME parts. */
export function attachmentLinksSection(links: AttachmentLink[]): { html: string; text: string } {
  if (!links.length) return { html: '', text: '' };
  const html =
    '<p>Attachments:</p><ul>' +
    links.map((l) => `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.fileName)}</a>${humanSize(l.size)}</li>`).join('') +
    '</ul>';
  const text = '\n\nAttachments:\n' + links.map((l) => `- ${l.fileName}${humanSize(l.size)}: ${l.url}`).join('\n');
  return { html, text };
}
