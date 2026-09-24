/**
 * The boundary between a note as words and a note as rich text.
 *
 * The job note is edited as rich text, but 79,708 notes came over from Workiz
 * as plain text with newlines, and several screens still show a note as plain
 * text — the jobs table truncates one, the quick view prints one. Both
 * directions therefore have to be exact: an imported note must open as
 * paragraphs rather than one run-on line, and no screen may ever show a tag.
 */

/**
 * Whether a stored note is rich text. Deliberately strict: real notes contain
 * things like "2004 ford F 150 <needs key>", and treating that as markup would
 * swallow half the note.
 */
export function isHtmlNote(note: string | undefined): boolean {
  if (!note) return false;
  return /<(p|ul|ol|li|br|strong|em|a|h[1-6])(\s[^>]*)?>/i.test(note);
}

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

/** A stored note, ready for the editor. */
export function noteToHtml(note: string | undefined): string {
  if (!note) return "";
  if (isHtmlNote(note)) return note;
  return note
    .split(/\r?\n/)
    .map((line) => `<p>${line.replace(/[&<>]/g, (c) => ESCAPE[c])}</p>`)
    .join("");
}

/** A stored note, as words — for anywhere that shows text and not markup. */
export function noteToText(note: string | undefined): string {
  if (!note) return "";
  if (!isHtmlNote(note)) return note;
  return note
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    // Last: an entity produced by an earlier replacement must not be decoded twice.
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
