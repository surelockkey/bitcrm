/**
 * TEST SUPPORT ONLY — nothing in the app imports this file.
 *
 * Every node panel reads the job catalogs and every one of them is driven the
 * same way: a node in state, a chain around it, and a count of how often it
 * was written back. Kept in one place so a test says what it is testing
 * rather than half a page of query client and MSW.
 */
import { useState, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { NodePanel } from "../node-panel";
import type { ChainNode } from "../types";

export const TAG_ID = "11111111-1111-5111-8111-111111111111";
export const SECOND_TAG_ID = "22222222-2222-5222-8222-222222222222";

export const SUB_STATUSES = [
  { id: "sub-done", name: "Paid in full", group: "done", color: "green", priority: 1, active: true },
  { id: "sub-cancel", name: "Canceled check", group: "canceled", color: "red", priority: 1, active: true },
];

/** The catalogs every panel resolves ids against. Call from `beforeEach`. */
export function serveCatalogs() {
  server.use(
    http.get("*/deals/job-tags", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: TAG_ID, name: "SCHEDULED", color: "blue", priority: 1, active: true },
          { id: SECOND_TAG_ID, name: "URGENT", color: "red", priority: 2, active: true },
        ],
      }),
    ),
    http.get("*/deals/job-types", () =>
      HttpResponse.json({ success: true, data: [{ id: "type-1", name: "Lock change", active: true }] }),
    ),
    http.get("*/deals/job-sources", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "src-gmb", name: "GMB", active: true },
          { id: "src-yelp", name: "Yelp", active: true },
        ],
      }),
    ),
    http.get("*/deals/job-statuses", () => HttpResponse.json({ success: true, data: SUB_STATUSES })),
    http.get("*/users", () =>
      HttpResponse.json({
        success: true,
        data: [{ id: "u1", firstName: "Ann", lastName: "Lee", email: "ann@example.test", status: "active" }],
        pagination: { count: 1 },
      }),
    ),
    http.get("*/users/roles", () =>
      HttpResponse.json({ success: true, data: [{ id: "r1", name: "Dispatch", permissions: {}, dataScope: {} }] }),
    ),
    http.get("*/messaging/templates/short-codes", () =>
      HttpResponse.json({
        success: true,
        data: [{ code: "job_date", group: "job", description: "The job's date", example: "Sep 20" }],
      }),
    ),
  );
}

/**
 * Let the catalogs answer and the panel re-render on them. A stray effect
 * writing the node back would fire in exactly this window, which is what the
 * "opened, not touched" tests are watching for.
 */
export async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export interface PanelDriver {
  /** The node as it stands after everything the test has done to it. */
  node: () => ChainNode;
  /** How often a panel wrote the node back — zero is what "opened, not touched" means. */
  writes: () => number;
  /** Takes the panel off the page, for a test that renders several in a row. */
  unmount: () => void;
}

/**
 * The panel as the chain canvas drives it: the node is held above the panel,
 * and every `onChange` replaces it. A panel that kept its own copy of the
 * rule would pass its own tests and lose the user's edits here.
 */
export function renderNodePanel(
  initial: ChainNode,
  options: { chain?: ChainNode[]; labels?: Record<string, string | undefined> } = {},
): PanelDriver {
  let latest = initial;
  let writes = 0;

  function Host(): ReactElement {
    const [node, setNode] = useState(initial);
    const chain = (options.chain ?? [initial]).map((n) => (n.id === node.id ? node : n));
    return (
      <NodePanel
        node={node}
        chain={chain}
        labels={options.labels ?? {}}
        onChange={(next) => {
          latest = next;
          writes += 1;
          setNode(next);
        }}
      />
    );
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );

  return { node: () => latest, writes: () => writes, unmount };
}
