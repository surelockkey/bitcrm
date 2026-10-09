import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AUTOMATION_TEMPLATES, AUTOMATION_TEMPLATE_SECTIONS } from "../templates";
import { AutomationLibrary } from "./automation-library";

const cardOf = (id: string) => screen.getByTestId(`automation-template-${id}`);

function renderLibrary(props: Partial<Parameters<typeof AutomationLibrary>[0]> = {}) {
  const onUse = vi.fn();
  render(<AutomationLibrary canEdit onUse={onUse} {...props} />);
  return { onUse };
}

describe("AutomationLibrary", () => {
  it("lists every section, in order, with its recipes", () => {
    renderLibrary();

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([...AUTOMATION_TEMPLATE_SECTIONS]);
    for (const template of AUTOMATION_TEMPLATES) {
      expect(within(cardOf(template.id)).getByText(template.title)).toBeInTheDocument();
    }
  });

  it("shows the sentence with its editable parts marked, and the blurb", () => {
    renderLibrary();
    const card = cardOf("job-canceled-notify-techs");

    expect(card).toHaveTextContent("When a job is canceled, send a text to the assigned techs");
    expect(within(card).getByText("canceled")).toHaveAttribute("data-template-slot");
    expect(within(card).getByText("the assigned techs")).toHaveAttribute("data-template-slot");
    expect(within(card).getByText(/hears it before they get there/)).toBeInTheDocument();
    expect(within(card).getByText("Most used here")).toBeInTheDocument();
  });

  it("hands the whole template back when Use is clicked", async () => {
    const user = userEvent.setup();
    const { onUse } = renderLibrary();

    await user.click(screen.getByRole("button", { name: "Use Completed call / Text client" }));

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith(AUTOMATION_TEMPLATES.find((t) => t.id === "completed-call-text-client"));
  });

  it("reaches Use with the keyboard alone — it is never hover-only", async () => {
    const user = userEvent.setup();
    const { onUse } = renderLibrary();

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `Use ${AUTOMATION_TEMPLATES[0].title}` }),
    );
    await user.keyboard("{Enter}");

    expect(onUse).toHaveBeenCalledWith(AUTOMATION_TEMPLATES[0]);
  });

  it("filters on the title, the sentence and the blurb", () => {
    const { rerender } = render(<AutomationLibrary canEdit search="answered" onUse={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Phone"]);
    expect(cardOf("completed-call-text-client")).toBeInTheDocument();
    expect(screen.queryByTestId("automation-template-missed-call-text-client")).not.toBeInTheDocument();

    // A word only the sentence has…
    rerender(<AutomationLibrary canEdit search="ahead of the job" onUse={vi.fn()} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Reminders"]);

    // …and one only a blurb has.
    rerender(<AutomationLibrary canEdit search="no-shows" onUse={vi.fn()} />);
    expect(cardOf("one-hour-notice-client-reminder")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^automation-template-/)).toHaveLength(1);
  });

  it("says so when nothing matches, in Workiz's words", () => {
    renderLibrary({ search: "quickbooks" });

    expect(screen.getByRole("heading", { name: "No results found" })).toBeInTheDocument();
    expect(screen.getByText("Try using different phrase or keywords.")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^automation-template-/)).toHaveLength(0);
  });

  it("takes the template on a click anywhere on its card, as Workiz does", async () => {
    const user = userEvent.setup();
    const { onUse } = renderLibrary();

    await user.click(within(cardOf("collect-reviews-1-day-after")).getByText("Collect reviews / 1 day after"));
    expect(onUse).toHaveBeenCalledWith(AUTOMATION_TEMPLATES.find((t) => t.id === "collect-reviews-1-day-after"));
  });

  it("without the permission to edit, offers no Use and says why", () => {
    renderLibrary({ canEdit: false });

    expect(screen.queryByRole("button", { name: /^Use / })).not.toBeInTheDocument();
    expect(screen.getByText(/needs permission to edit them/)).toBeInTheDocument();
    // The recipes themselves are still readable.
    expect(screen.getAllByTestId(/^automation-template-/)).toHaveLength(AUTOMATION_TEMPLATES.length);
  });
});
