/**
 * Workiz stores template bodies as HTML (`<p>Hi {{client_first_name}}!</p>`,
 * `&nbsp;`), and SMS carries plain text. This is the one conversion both the
 * SMS length check (create/update) and the renderer use, so a template that
 * validates is the template that is sent.
 *
 * Deliberately small: block closers become line breaks, every other tag is
 * dropped, the handful of entities Draft.js emits are decoded. Input without
 * tags passes through untouched apart from entity decoding.
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return NAMED_ENTITIES[lower] ?? match;
  });
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/\r\n?/g, '\n')
    // Line breaks between two tags are source formatting (`</p>\n<p>`), not
    // content; a single inline space (`</b> <i>`) is content and stays.
    .replace(/>[ \t]*\n\s*</g, '><')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the body carries markup the SMS path has to strip. */
export const looksLikeHtml = (body: string): boolean => /<[a-z][^>]*>/i.test(body);
