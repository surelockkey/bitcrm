import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../hooks", () => ({
  useCreateWarehouse: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { WarehouseCreateDialog } from "./warehouse-create-dialog";

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.push.mockReset();
});

describe("WarehouseCreateDialog", () => {
  it("creates a warehouse from its name, address and description", async () => {
    render(<WarehouseCreateDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Name"), "Dallas");
    await userEvent.type(screen.getByLabelText("Address"), "800 W Campbell Rd");
    await userEvent.click(screen.getByRole("button", { name: "Create warehouse" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { name: "Dallas", address: "800 W Campbell Rd", description: "" },
      expect.anything(),
    );
  });

  it("closes once created and stays on the list — there is no warehouse page to go to", async () => {
    mocks.mutate.mockImplementation((_body, opts) => opts.onSuccess({ id: "w5", name: "Dallas" }));
    const onOpenChange = vi.fn();
    render(<WarehouseCreateDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByLabelText("Name"), "Dallas");
    await userEvent.click(screen.getByRole("button", { name: "Create warehouse" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
