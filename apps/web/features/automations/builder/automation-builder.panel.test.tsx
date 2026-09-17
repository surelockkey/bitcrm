import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AutomationRule } from "@bitcrm/types";
import type { ChainNode } from "./types";

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));

/**
 * The real settings panel (spec §5) is a form: popovers that stay open, a
 * message being typed, an "or" alternative half built — all of it state the
 * panel holds itself. This stands in for that, so the chain can be held to the
 * one thing it owes such a panel: a fresh one per step.
 *
 * Without it the test would pass against a broken chain, because the
 * placeholder panel in the tree today has no state to carry over.
 */
vi.mock("./node-panel", async () => {
  const actual = await vi.importActual<typeof import("./node-panel")>("./node-panel");
  return {
    ...actual,
    NodePanel: ({ node }: { node: ChainNode }) => {
      const [draft, setDraft] = useState("");
      return (
        <div>
          <span data-testid="panel-step">{node.id}</span>
          <input aria-label="Half-typed message" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </div>
      );
    },
  };
});

const { AutomationBuilderDialog } = await import("./automation-builder");

const rule: AutomationRule = {
  id: "r1",
  name: "Two sends",
  enabled: false,
  runnable: true,
  specSource: "user",
  spec: {
    version: 1,
    trigger: { kind: "deal.created" },
    conditions: [],
    actions: [
      { type: "send_sms", to: "client", body: "First" },
      { type: "send_sms", to: "assigned_techs", body: "Second" },
    ],
  },
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

function renderBuilder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationBuilderDialog rule={rule} open labels={{}} onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("the settings panel and the step it belongs to", () => {
  it("builds a fresh panel per step, so one step's half-typed answer never shows under another", async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.click(await screen.findByRole("button", { name: /^Step 2, Send/ }));
    expect(screen.getByTestId("panel-step")).toHaveTextContent("s-a0");
    await user.type(screen.getByLabelText("Half-typed message"), "Running late");

    await user.click(screen.getByRole("button", { name: /^Step 3, Send/ }));
    expect(screen.getByTestId("panel-step")).toHaveTextContent("s-a1");
    expect(screen.getByLabelText("Half-typed message")).toHaveValue("");

    // And back: step 2's panel is built again too, rather than being the one
    // step 3 left behind.
    await user.click(screen.getByRole("button", { name: /^Step 2, Send/ }));
    expect(screen.getByLabelText("Half-typed message")).toHaveValue("");
  });
});
