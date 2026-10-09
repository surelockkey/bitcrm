import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
    actions: [{ type: "send_sms", to: "assigned_techs", body: "CLIENT CANCELED for {{first_name}}" }],
  },
  ...over,
});

const handlers = {
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onRename: vi.fn(),
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

/** The sentence is drawn in parts (its slots underlined), so it is found by its whole text. */
const sentence = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

describe("AutomationRuleCard", () => {
  it("shows the name, the sentence and Workiz's info row", () => {
    renderCard();

    expect(screen.getByRole("heading", { name: "Canceled job & techs" })).toBeInTheDocument();
    // "Canceled", not the `canceled` the trigger stores: a card handed no
    // catalog at all still knows the super-statuses, because they are an enum.
    expect(sentence("When a job has a status of Canceled, send the assigned tech a text message immediately")).toBeInTheDocument();
    expect(screen.getByText("Created on Oct 9, 2024")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Firing log of Canceled job & techs" })).toHaveTextContent(
      "Triggered 5411 times",
    );
    expect(screen.getByText(/This rule contains/)).toHaveTextContent("This rule contains 0 conditions");
    expect(screen.getByText(/Last fired Sep 14/)).toBeInTheDocument();
  });

  it("underlines the parts of the sentence somebody picked", () => {
    renderCard();
    const slots = [...document.querySelectorAll("[data-sentence-slot]")].map((s) => s.textContent);
    expect(slots).toEqual(["a job", "has a status", "Canceled", "send", "the assigned tech", "a text message", "immediately"]);
  });

  it("dates an imported rule the way Workiz does", () => {
    renderCard({ validFrom: "2024-09-30T13:47:38.903Z" });
    expect(screen.getByText("Modified on Sep 30, 2024")).toBeInTheDocument();
  });

  it("leaves out the parts a rule has no data for", () => {
    renderCard({ firedCount: undefined, lastFiredAt: undefined });

    expect(screen.getByRole("button", { name: /firing log/i })).toHaveTextContent("Triggered 0 times");
    expect(screen.queryByText(/Last fired/)).not.toBeInTheDocument();
  });

  it("counts a single firing and a single condition in the singular", () => {
    renderCard({
      firedCount: 1,
      spec: { ...rule().spec!, conditions: [{ field: "hasTechs", op: "exists" }] },
    });
    expect(screen.getByRole("button", { name: /firing log/i })).toHaveTextContent(/^Triggered 1 time$/);
    expect(screen.getByText(/This rule contains/)).toHaveTextContent("This rule contains 1 condition");
  });

  it("keeps the Workiz count and the translator's note", () => {
    renderCard({ workizTriggered: 17476, specNotes: ["The email copy was dropped"] });

    expect(screen.getByText("17476 in Workiz")).toBeInTheDocument();
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

  it("offers Workiz's Preview, Edit, Duplicate, Rename and Delete, and our View history", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Preview",
      "Edit",
      "Duplicate",
      "Rename",
      "View history",
      "Delete",
    ]);

    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(handlers.onDuplicate).toHaveBeenCalled();
  });

  it("previews the message the rule sends, as Workiz's TEXT TEMPLATE", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(screen.getByRole("menuitem", { name: "Preview" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Text template")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("CLIENT CANCELED for {…} first_name");
  });

  it("offers no Preview for a rule that sends no message", async () => {
    const user = userEvent.setup();
    renderCard({ spec: undefined, runnable: false });

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    expect(screen.queryByRole("menuitem", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("renames the rule in place: Enter keeps the new name, Escape keeps the old", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = await screen.findByRole("textbox", { name: "Rule name" });
    expect(field).toHaveValue("Canceled job & techs");
    await user.clear(field);
    await user.type(field, "Canceled jobs{Enter}");
    expect(handlers.onRename).toHaveBeenCalledWith("Canceled jobs");
    expect(screen.queryByRole("textbox", { name: "Rule name" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    await user.type(await screen.findByRole("textbox", { name: "Rule name" }), " v2{Escape}");
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Canceled job & techs" })).toBeInTheDocument();
  });

  it("does not rename to nothing, or to the name it already has", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = await screen.findByRole("textbox", { name: "Rule name" });
    await user.clear(field);
    await user.type(field, "   {Enter}");
    expect(handlers.onRename).not.toHaveBeenCalled();
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

    // In the menu, not on hover: a disabled item takes no keyboard focus,
    // so a tooltip hung on it would never be read.
    expect(screen.getByText("A built-in rule is turned off, not deleted.")).toBeInTheDocument();

    await user.click(remove);
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it("gives a reader the message and the history, and nothing that changes the rule", async () => {
    const user = userEvent.setup();
    renderCard({}, false);

    expect(screen.getByRole("switch")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Actions for Canceled job & techs" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Preview", "View history"]);
  });

  it("opens the rule for an editor who clicks the card itself", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(sentence("When a job has a status of Canceled, send the assigned tech a text message immediately"));
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    // The switch on the card is its own control.
    await user.click(screen.getByRole("switch"));
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
  });
});
