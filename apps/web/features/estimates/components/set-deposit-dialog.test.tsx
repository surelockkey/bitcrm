import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetDepositDialog, depositBoxText, depositLabel } from "./set-deposit-dialog";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("depositLabel", () => {
  it("prints Workiz's deposit title: the amount due and the percent when it is one", () => {
    expect(depositLabel({ depositPercentage: 50, totals: { total: 3511.22 } } as never)).toBe("$1,755.61 (50%)");
    expect(depositLabel({ depositAmount: 75, totals: { total: 300 } } as never)).toBe("$75.00");
    expect(depositLabel({ totals: { total: 300 } } as never)).toBeNull();
  });
});

describe("depositBoxText", () => {
  it("prints Workiz's Deposit box: the amount, then the percent to two places when it is one", () => {
    expect(depositBoxText({ depositPercentage: 50, totals: { total: 1003.39 } } as never)).toBe("501.70 (50.00%)");
    expect(depositBoxText({ depositPercentage: 12.5, totals: { total: 0 } } as never)).toBe("0.00 (12.50%)");
    expect(depositBoxText({ depositAmount: 1250, totals: { total: 3000 } } as never)).toBe("1,250.00");
    expect(depositBoxText({ totals: { total: 300 } } as never)).toBe("0.00");
  });
});

describe("SetDepositDialog (Workiz Set deposit)", () => {
  it("saves a percent, or a fixed amount, and can set it for future estimates too", async () => {
    const onSave = vi.fn(async () => undefined);
    render(<SetDepositDialog open onOpenChange={vi.fn()} total={200} current={{}} canSetDefault onSave={onSave} />);
    await user().click(screen.getByRole("radio", { name: "%" }));
    await user().clear(screen.getByLabelText("Deposit amount"));
    await user().type(screen.getByLabelText("Deposit amount"), "50");
    expect(screen.getByText(/\$100\.00 of \$200\.00/)).toBeInTheDocument();
    await user().click(screen.getByLabelText(/set for future estimates/i));
    await user().click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ depositPercentage: 50, depositAmount: null }, true));

    onSave.mockClear();
    await user().click(screen.getByRole("radio", { name: "$" }));
    await user().clear(screen.getByLabelText("Deposit amount"));
    await user().type(screen.getByLabelText("Deposit amount"), "75");
    await user().click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ depositAmount: 75, depositPercentage: null }, true));
  });

  it("starts from the estimate's own deposit and clears it with 0", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <SetDepositDialog open onOpenChange={vi.fn()} total={200} current={{ depositPercentage: 25 }} canSetDefault={false} onSave={onSave} />,
    );
    expect(screen.getByRole("radio", { name: "%" })).toBeChecked();
    expect(screen.getByLabelText("Deposit amount")).toHaveValue(25);
    expect(screen.queryByLabelText(/set for future estimates/i)).not.toBeInTheDocument();
    await user().clear(screen.getByLabelText("Deposit amount"));
    await user().type(screen.getByLabelText("Deposit amount"), "0");
    await user().click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ depositPercentage: null, depositAmount: null }, false));
  });

  it("refuses more than 100% or a negative amount", async () => {
    render(<SetDepositDialog open onOpenChange={vi.fn()} total={200} current={{}} canSetDefault onSave={vi.fn()} />);
    await user().click(screen.getByRole("radio", { name: "%" }));
    await user().clear(screen.getByLabelText("Deposit amount"));
    await user().type(screen.getByLabelText("Deposit amount"), "150");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/between 0 and 100/i)).toBeInTheDocument();
  });
});
