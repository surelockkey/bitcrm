import type { ReactElement } from "react";
import { screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { renderWithClient, type FakeRoute } from "@/test/page-load";

/**
 * What the Inventory and Price Book loading tests share, on top of
 * `test/page-load`: the signed-in user the permissions come from, a page of
 * a list the way the server pages it, and two things to watch while a page
 * loads. Test-only; nothing in the app imports it.
 */

/** `GET /users/me` — the permissions are resolved from the role it names. */
export function meRoute(roleId: string, delayMs?: number): FakeRoute {
  return {
    match: /\/users\/me$/,
    delayMs,
    reply: () => ({
      id: "u-me",
      cognitoSub: "sub-me",
      email: "dana@example.test",
      firstName: "Dana",
      lastName: "Office",
      roleId,
      department: "Office",
      status: "active",
      createdAt: "",
      updatedAt: "",
    }),
  };
}

/** One server page of a list: `{ success, data, pagination }`, as the paged endpoints answer. */
export function pageRoute(match: RegExp, rows: () => unknown[], delayMs?: number): FakeRoute {
  return { match, delayMs, raw: true, reply: () => ({ success: true, data: rows(), pagination: {} }) };
}

/** `GET …/count` — what the pager's "of N" comes from. */
export function countRoute(match: RegExp, total: () => number, delayMs?: number): FakeRoute {
  return { match, delayMs, reply: () => ({ total: total(), atLeast: false }) };
}

/** The pager's "Showing …" line, or null while there is none. */
export function pagerText(): string | null {
  const bar = document.querySelector('[data-testid="list-pagination"]');
  return bar ? (bar.textContent ?? "").replace(/\s+/g, " ").trim() : null;
}

/**
 * Whether a pager was ever on screen under skeleton rows.
 *
 * Under a skeleton the pager sits where a page of placeholder rows ends —
 * fifty rows down, on a first visit — and the real rows move it: three
 * warehouses pulled it from below the fold into the middle of the screen (the
 * browser's layout shift, 0.047). Drawn with the rows instead, it appears in
 * its place and never moves.
 */
export function watchPagerUnderSkeleton(): { seen: () => boolean; stop: () => void } {
  let seen = false;
  const check = () => {
    if (seen) return;
    seen =
      !!document.querySelector('[data-testid="list-pagination"]') &&
      !!document.querySelector('[data-testid="skeleton-row"]');
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  check();
  return { seen: () => seen, stop: () => observer.disconnect() };
}

/** The toolbar's controls, by their names — what a reader sees across the top. */
export function controlsIn(toolbar: HTMLElement): string[] {
  return [...toolbar.querySelectorAll("button, input")].map(
    (el) =>
      el.getAttribute("aria-label") ||
      (el as HTMLInputElement).placeholder ||
      (el.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

/** `renderWithClient`, inside the providers the app shell gives every page (the rows' icon buttons have tooltips). */
export function renderPage(ui: ReactElement) {
  return renderWithClient(<TooltipProvider>{ui}</TooltipProvider>);
}

export { screen };
