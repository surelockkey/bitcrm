import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzWindowFrame } from "./window-frame";

/**
 * Workiz's full-window modal (`_full modal`, the role editor —
 * pg_admin_users_wz_10_role_dispatch) drawn by a page: the whole window, 16px
 * corners, the 18px/600 title at 24/24 with × at the right, the body
 * scrolling under it, an 80px white footer with its buttons at the right.
 */
describe("WzWindowFrame", () => {
  it("is a region named by its title, with the body and the footer", () => {
    render(
      <WzWindowFrame title="Edit permissions for role dispatch" onClose={() => {}} footer={<button type="button">Save</button>}>
        <p>rows</p>
      </WzWindowFrame>,
    );
    const frame = screen.getByRole("region", { name: "Edit permissions for role dispatch" });
    expect(screen.getByRole("heading", { level: 4, name: "Edit permissions for role dispatch" })).toBeInTheDocument();
    expect(frame).toContainElement(screen.getByText("rows"));
    expect(frame).toContainElement(screen.getByRole("button", { name: "Save" }));
  });

  it("× closes it", async () => {
    const onClose = vi.fn();
    render(
      <WzWindowFrame title="Edit" onClose={onClose} closeLabel="Close the role">
        x
      </WzWindowFrame>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close the role" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("draws no footer bar without a footer", () => {
    render(
      <WzWindowFrame title="Edit" onClose={() => {}}>
        x
      </WzWindowFrame>,
    );
    expect(document.querySelector("[data-slot=wz-window-frame-footer]")).toBeNull();
  });

  it("puts what follows the title beside it (chips)", () => {
    render(
      <WzWindowFrame title="Edit" titleAfter={<span>System</span>} onClose={() => {}}>
        x
      </WzWindowFrame>,
    );
    expect(screen.getByText("System")).toBeInTheDocument();
  });
});
