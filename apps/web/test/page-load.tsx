import { vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

/**
 * A page as the browser loads it, for the tests that keep pages from jumping.
 *
 * The real page, its real hooks and a real QueryClient, against a fake server
 * that answers at `fetch` — the lowest layer, so every request the page makes
 * is seen, whichever API module made it. Then two questions:
 *
 * - what was on screen in the very first frame the page showed itself
 *   (`watchFirstFrame`) — caught by a MutationObserver at the commit itself,
 *   not by polling, which would miss a wave that lands within the interval;
 * - what was asked for, and whether anything was asked for twice
 *   (`duplicates`) or after the page was up.
 *
 * A wave — a block that fetches for itself once it has mounted — shows up as
 * a hole in the first frame or a request after it.
 *
 * Usage:
 *
 *   const server = installFakeServer([
 *     { match: /\/deals\/d1$/, reply: () => deal },
 *     { match: /\/users$/, reply: () => ({ data: users, pagination: {} }), raw: true },
 *   ]);
 *   const watch = watchFirstFrame(() => !!screen.queryByText("#1042"), () => ({
 *     client: !!screen.queryByDisplayValue("Jane"),
 *   }));
 *   renderWithClient(<DealDetailPage dealId="d1" />);
 *   await screen.findByText("#1042");
 *   expect(watch.frame()).toEqual({ client: true });
 *   await settle();
 *   expect(duplicates(server.requests)).toEqual([]);
 */

export interface FakeRoute {
  /** Tested against the path, without the query string (`/api` prefix included). */
  match: RegExp;
  /** Only this method; any when left out. */
  method?: string;
  /** The `data` of the `{ success, data }` envelope — or, with `raw`, the whole body. */
  reply: (url: URL, init?: RequestInit) => unknown;
  raw?: boolean;
  status?: number;
  /** This route's own beat — to reproduce an order the browser sees (rows before the catalog). */
  delayMs?: number;
}

export interface FakeServer {
  /** Every request, in order, as `path?query`. */
  requests: string[];
  /** Requests no route answered (they got `data: null`) — handy when a page renders oddly. */
  unanswered: string[];
  /** From now on, answer paths matching this with a 500. */
  fail: (match: RegExp) => void;
}

/**
 * Stub `fetch` for the test. Each answer comes after `delayMs` — the waves
 * only show with time between them. Restore with `vi.unstubAllGlobals()`
 * (the setup file does not do it for you).
 */
export function installFakeServer(routes: FakeRoute[], { delayMs = 20 }: { delayMs?: number } = {}): FakeServer {
  const server: FakeServer = { requests: [], unanswered: [], fail: (m) => failing.push(m) };
  const failing: RegExp[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString(), "http://test");
      const method = (init?.method ?? "GET").toUpperCase();
      server.requests.push(url.pathname + url.search);
      const route = routes.find((r) => r.match.test(url.pathname) && (!r.method || r.method.toUpperCase() === method));
      return new Promise<Response>((resolve) =>
        setTimeout(() => {
          if (failing.some((re) => re.test(url.pathname))) {
            resolve(new Response(JSON.stringify({ success: false, message: "boom" }), { status: 500 }));
            return;
          }
          if (!route) server.unanswered.push(`${method} ${url.pathname}${url.search}`);
          const body = route
            ? route.raw
              ? route.reply(url, init)
              : { success: true, data: route.reply(url, init) }
            : { success: true, data: null };
          resolve(new Response(JSON.stringify(body), { status: route?.status ?? 200 }));
        }, route?.delayMs ?? delayMs),
      );
    }),
  );
  return server;
}

/** Render with a fresh QueryClient (no retries — a failure should show at once). */
export function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/**
 * What `probe` saw in the first frame in which `isUp` held — taken at the
 * commit that put the page up. Start it before rendering; `stop` it after.
 */
export function watchFirstFrame<T>(isUp: () => boolean, probe: () => T): { frame: () => T | null; stop: () => void } {
  let first: T | null = null;
  const observer = new MutationObserver(() => {
    if (first !== null || !isUp()) return;
    first = probe();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  return { frame: () => first, stop: () => observer.disconnect() };
}

/** How many skeletons are on screen (inside `root`, the whole page by default). */
export function skeletonCount(root: ParentNode = document): number {
  return root.querySelectorAll('[data-slot="skeleton"]').length;
}

/** The requests made more than once, once each. */
export function duplicates(requests: string[]): string[] {
  return [...new Set(requests.filter((r, i) => requests.indexOf(r) !== i))];
}

/** Long enough for any block that fetches for itself to have asked. */
export function settle(ms = 200): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { screen };
