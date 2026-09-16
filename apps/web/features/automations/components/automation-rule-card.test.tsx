import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AutomationRule } from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AutomationRuleCard } from "./automation-rule-card";

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: "r1",
  name: "Canceled job & techs",
  enabled: true,
  firedCount: 5411,
  lastFiredAt: "2026-09-14T15:04:00.000Z",
  updatedAt: "2024-10-09T12:00:00.000Z",
  createdAt: "2024-10-09T12:00:00.000Z",
  runnable: true,
  spec: {
    version: 1,
    trigger: { kind: "deal.status_changed", to: ["canceled"] },
    conditions: [],
    actions: [{ type: "send_sms", to: "assigned_techs", body: "CLIENT CANCELED" }],
  },
  ...over,
});

const handlers = {
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onHistory: vi.fn(),
  onDelete: vi.fn(),
};

beforeEach(() => {
  for (const fn of Object.values(handlers)) fn.mockClear();
});

function renderCard(over: Partial<AutomationRule> = {}, canEdit = true) {
  return render(
    <TooltipProvider>
      <AutomationRuleCard rule={rule(over)} canEdit={canEdit} {...handlers} />
    </TooltipProvider>,
  );
}

describe("AutomationRuleCard", () => {
  it("shows the name, its badges, the sentence and the one stats line", () => {
    renderCard();

    expect(screen.getByText("Canceled job & techs")).toBeInTheDocument();
    // No category on the rule — it was written here, so it reads as Custom.
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("Job status changes")).toBeInTheDocument();
    expect(
      screen.getByText(
        "When a job has a status of canceled, send the assigned tech a text message immediately",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Firing log of Canceled job & techs" })).toHaveTextContent(
      "5,411 firings",
    );
    expect(screen.getByText(/last fired Sep 14/)).toBeInTheDocument();
    expect(screen.getByText("edited Oct 9, 2024")).toBeInTheDocument();
  });

  it("names the library section a recipe came from", () => {
    renderCard({ category: "followUps" });
    expect(screen.getByText("Follow-ups")).toBeInTheDocument();
  });

  it("leaves out the parts a rule has no data for", () => {
    renderCard({ firedCount: undefined, lastFiredAt: undefined });

    expect(screen.getByRole("button", { name: /firing log/i })).toHaveTextContent("0 firings");
    expect(screen.queryByText(/last fired/)).not.toBeInTheDocument();
  });

  it("keeps the Workiz count and the translator's note", () => {
    renderCard({ workizTriggered: 17476, specNotes: ["The email copy was dropped"] });

    expect(screen.getByText("17,476 in Workiz")).toBeInTheDocument();
    expect(screen.getByText("The email copy was dropped")).toBeInTheDocument();
  });

  it("cannot be switched on when the engine cannot run it, and says why", async () => {
    const user = userEvent.setup();
    renderCard({ enabled: false, runnable: false, spec: undefined, notRunnableReason: "No invoices here" });

    expect(screen.getByRole("switch")).toBeDisabled();
    await user.hover(screen.getByText("Cannot run here"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("No invoices here");
  });

  it("switches the rule off", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("switch", { name: "Disable Canceled job & techs" }));
    expect(handlers.onToggle).toHaveBeenCalledWith(false);
  });

  it("offers Edit, Duplicate, View history and Delete", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Edit",
      "Duplicate",
      "View history",
      "Delete",
    ]);

    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(handlers.onDuplicate).toHaveBeenCalled();
  });

  it("asks to delete without deleting anything itself", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete Canceled job & techs" }));
    expect(handlers.onDelete).toHaveBeenCalled();
  });

  it("never deletes a built-in rule, and explains that it is turned off instead", async () => {
    const user = userEvent.setup();
    renderCard({ builtin: true, name: "New job SMS" });

    await user.click(screen.getByRole("button", { name: "Actions for New job SMS" }));
    const remove = screen.getByRole("menuitem", { name: "Delete New job SMS" });
    expect(remove).toHaveAttribute("aria-disabled", "true");

    await user.hover(remove.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "A built-in rule is turned off, not deleted.",
    );
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it("gives a reader the history and nothing that changes the rule", async () => {
    const user = userEvent.setup();
    renderCard({}, false);

    expect(screen.getByRole("switch")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["View history"]);
  });
});
