import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzSuggestion, WzSuggestionList, splitMatch } from "./suggestions";

describe("splitMatch", () => {
  it("cuts the text round the first case-insensitive match", () => {
    expect(splitMatch("Dustin Roselle (#388843)", "dustin")).toEqual(["", "Dustin", " Roselle (#388843)"]);
    expect(splitMatch("Mary Dustin", "DUST")).toEqual(["Mary ", "Dust", "in"]);
  });

  it("leaves the text whole when nothing matches or nothing is typed", () => {
    expect(splitMatch("Alice", "zz")).toEqual(["Alice", "", ""]);
    expect(splitMatch("Alice", "  ")).toEqual(["Alice", "", ""]);
  });
});

describe("WzSuggestionList", () => {
  it("is a listbox of options, the typed part in bold", () => {
    render(
      <WzSuggestionList aria-label="Clients">
        <WzSuggestion title="+ Add new" query="Dustin" addNew />
        <WzSuggestion title="Dustin Roselle (#388843)" subtitle="Princeton" query="Dustin" />
      </WzSuggestionList>,
    );
    const list = screen.getByRole("listbox", { name: "Clients" });
    const options = screen.getAllByRole("option");
    expect(list).toContainElement(options[0]);
    expect(options).toHaveLength(2);
    // "+ Add new "Dustin"" — the typed text bold inside quotes.
    expect(options[0]).toHaveTextContent('+ Add new "Dustin"');
    expect(options[1].querySelector("b")).toHaveTextContent("Dustin");
    expect(screen.getByText("Princeton")).toBeInTheDocument();
  });

  it("picks on click without taking focus from the input", async () => {
    const onSelect = vi.fn();
    render(
      <>
        <input aria-label="Client name" />
        <WzSuggestionList aria-label="Clients">
          <WzSuggestion title="Dustin Roselle" query="" onSelect={onSelect} />
        </WzSuggestionList>
      </>,
    );
    const input = screen.getByLabelText("Client name");
    input.focus();
    await userEvent.click(screen.getByRole("option"));
    expect(onSelect).toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it("marks the keyboard's row", () => {
    render(
      <WzSuggestionList aria-label="Clients">
        <WzSuggestion title="A" query="" active />
        <WzSuggestion title="B" query="" />
      </WzSuggestionList>,
    );
    const [a, b] = screen.getAllByRole("option");
    expect(a).toHaveAttribute("aria-selected", "true");
    expect(b).toHaveAttribute("aria-selected", "false");
  });
});
