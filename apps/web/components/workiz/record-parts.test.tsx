import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzFold, WzLeftBorderBox, WzSegmented, WzTotalsBar } from "./record-parts";

describe("WzLeftBorderBox / WzTotalsBar — the client page's totals", () => {
  it("prints the caption over the figure; danger turns the figure red", () => {
    render(
      <WzTotalsBar aria-label="Client totals">
        <WzLeftBorderBox label="Past due" value="$0.00" tone="danger" />
        <WzLeftBorderBox label="Due" value="$110,122.00" />
      </WzTotalsBar>,
    );
    const bar = screen.getByRole("group", { name: "Client totals" });
    expect(bar).toHaveTextContent("Past due$0.00Due$110,122.00");
    expect(screen.getByText("$0.00")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("$110,122.00")).not.toHaveAttribute("data-tone");
  });
});

describe("WzFold — a folding section of the record's left column", () => {
  it("opens and closes on its title; closed by default; an action sits apart from the title", async () => {
    const onAdd = vi.fn();
    render(
      <WzFold title="Additional contacts (2)" action={<button type="button" onClick={onAdd}>Add contact</button>}>
        <p>Tanner Brady</p>
      </WzFold>,
    );
    const head = screen.getByRole("button", { name: "Additional contacts (2)" });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Tanner Brady")).toBeNull();
    await userEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Tanner Brady")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add contact" }));
    expect(onAdd).toHaveBeenCalled();
    expect(head).toHaveAttribute("aria-expanded", "true");
  });

  it("can start open", () => {
    render(
      <WzFold title="Addresses" defaultOpen>
        <p>Service address</p>
      </WzFold>,
    );
    expect(screen.getByText("Service address")).toBeInTheDocument();
  });
});

describe("WzSegmented — Workiz's All | Media | Documents switch", () => {
  it("is a tab list: one pressed, a click moves it", async () => {
    const onChange = vi.fn();
    render(
      <WzSegmented
        aria-label="Show"
        value="media"
        onChange={onChange}
        options={[
          { value: "all", label: "All" },
          { value: "media", label: "Media" },
          { value: "documents", label: "Documents" },
        ]}
      />,
    );
    expect(screen.getByRole("tablist", { name: "Show" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Media" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "false");
    await userEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(onChange).toHaveBeenCalledWith("documents");
  });
});
