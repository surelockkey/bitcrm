/** The few entities Workiz's template HTML carries. */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/**
 * A template as the editor shows it: Workiz stores HTML, so paragraphs and
 * `<br>` become lines, other tags go, entities are read ("&amp;" → "&").
 */
export function templateText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)
    .trim();
}

/** A template on one line — the lists' grey second line. */
export function templateSnippet(html: string): string {
  return templateText(html).replace(/\s+/g, " ").trim();
}
