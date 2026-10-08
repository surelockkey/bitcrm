/**
 * The widgets a person has taken off their dashboard — Workiz's "Dashboard
 * widgets" panel and the kebab's "Remove". Kept per user in this browser (as
 * the jobs list keeps its Visible fields); storage that throws or holds
 * rubbish reads as nothing hidden, never as an error.
 */

const key = (userId: string) => `bitcrm:dashboard:hidden:${userId}`;

export function readHidden(userId: string): string[] {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export function writeHidden(userId: string, hidden: string[]): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(hidden));
  } catch {
    // A private window or blocked storage: the choice lasts for this visit only.
  }
}
