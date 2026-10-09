import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzRowIconButton, WzShortCodeChips, WzTabIntro, shortCodeLabel } from "./phone-tab-parts";

describe("WzTabIntro — the words and the big button under a Workiz Phone tab", () => {
  it("draws the words at the left and the caller's button at the right", () => {
    render(<WzTabIntro action={<button type="button">Add number</button>}>Manage your phone numbers</WzTabIntro>);
    expect(screen.getByText("Manage your phone numbers").tagName).toBe("P");
    expect(screen.getByRole("button", { name: "Add number" })).toBeInTheDocument();
  });

  it("draws the words alone when the reader may not add", () => {
    const { container } = render(<WzTabIntro>Call flows route your calls</WzTabIntro>);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("WzRowIconButton — a grid row's 24px icon", () => {
  it("is a named button whose click stays out of the row", async () => {
    const onClick = vi.fn();
    const onRow = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onRow}>
        <WzRowIconButton label="Delete Main line" onClick={onClick}>
          x
        </WzRowIconButton>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete Main line" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("is a link when it goes somewhere (Workiz's edit icon opens the builder)", () => {
    render(
      <WzRowIconButton label="Edit Main line" href="/calls/flows/f1">
        x
      </WzRowIconButton>,
    );
    expect(screen.getByRole("link", { name: "Edit Main line" })).toHaveAttribute("href", "/calls/flows/f1");
  });
});

describe("shortCodeLabel — Workiz's chip words", () => {
  it("capitalises every word of the code", () => {
    expect(shortCodeLabel("job_id")).toBe("Job Id");
    expect(shortCodeLabel("tech_assigned")).toBe("Tech Assigned");
    expect(shortCodeLabel("biz_name")).toBe("Biz Name");
  });
});

describe("WzShortCodeChips — the short codes under a Text templates box", () => {
  it("lists every code as a chip and puts {{code}} in on a click", async () => {
    const onInsert = vi.fn();
    render(<WzShortCodeChips label="Short codes for On the Way" codes={["first_name", "tech_assigned"]} onInsert={onInsert} />);
    expect(screen.getByRole("group", { name: "Short codes for On the Way" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tech Assigned" }));
    expect(onInsert).toHaveBeenCalledWith("{{tech_assigned}}");
  });

  it("lets nobody insert when the box is read-only", () => {
    render(<WzShortCodeChips label="Codes" codes={["first_name"]} onInsert={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "First Name" })).toBeDisabled();
  });
});
