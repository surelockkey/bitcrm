import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssignedTechRow } from "./assigned-tech-row";

/**
 * Workiz gives each assigned technician a row of their own: a coloured avatar,
 * the name, and the things you do with that person on the right — look them
 * up, call them, message them, take them off the job. A line of chips has
 * nowhere to put any of that.
 */
const tech = { id: "u1", firstName: "Reonquez", lastName: "Thompson", phone: "+14692451831", email: "r@example.com" };

describe("AssignedTechRow", () => {
  it("shows the technician by name", () => {
    render(<AssignedTechRow techId="u1" user={tech} />);
    expect(screen.getByText("Reonquez Thompson")).toBeInTheDocument();
  });

  it("never shows the id while the directory is still on its way", () => {
    const { container } = render(<AssignedTechRow techId="u1" user={undefined} />);
    expect(container.textContent).not.toContain("u1");
  });

  it("gives the technician their own colour, so a dispatcher recognises them", () => {
    const { container } = render(<AssignedTechRow techId="u1" user={tech} />);
    const avatar = container.querySelector("[data-slot='tech-avatar']");
    expect(avatar?.className).toMatch(/bg-/);
  });

  it("carries the buttons it is given, on the right", () => {
    render(
      <AssignedTechRow techId="u1" user={tech}>
        <button type="button">Call</button>
      </AssignedTechRow>,
    );
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
  });

  it("takes the technician off the job when asked", async () => {
    const onRemove = vi.fn();
    render(<AssignedTechRow techId="u1" user={tech} onRemove={onRemove} />);

    await userEvent.click(screen.getByRole("button", { name: "Remove Reonquez Thompson" }));

    expect(onRemove).toHaveBeenCalledWith("u1");
  });

  it("offers no way to remove anyone when removing is not allowed", () => {
    render(<AssignedTechRow techId="u1" user={tech} />);
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
