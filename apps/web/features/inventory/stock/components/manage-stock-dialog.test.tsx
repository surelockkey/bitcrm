import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ManageStockDialog } from "./manage-stock-dialog";

// Stage 2 ships the shell the Items tab opens; stage 3 fills in the locations.
describe("ManageStockDialog (shell)", () => {
  it("opens as the Manage stock popup", () => {
    render(<ManageStockDialog productId="p1" open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: /Manage stock/ })).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    render(<ManageStockDialog productId="p1" open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from Done", async () => {
    const onOpenChange = vi.fn();
    render(<ManageStockDialog productId="p1" open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
