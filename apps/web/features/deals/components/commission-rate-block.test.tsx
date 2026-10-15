import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommissionRateBlock } from "./commission-rate-block";

/**
 * Workiz's "Commission rate" block on the job (app_audit_wz_disp_job_tab_items):
 * h4 + yellow "Update", then "Custom Tech Rate:" with an OFF/ON switch. On, the
 * job pays its technician this rate — % of the split or $ fixed — instead of
 * his own; Update writes it to the job.
 */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderBlock(over: Partial<Parameters<typeof CommissionRateBlock>[0]> = {}) {
  const onUpdate = vi.fn();
  render(<CommissionRateBlock rate={{}} canEdit pending={false} onUpdate={onUpdate} {...over} />);
  return { onUpdate };
}

describe("CommissionRateBlock", () => {
  it("shows Workiz's block: heading, Update, and Custom Tech Rate off", () => {
    renderBlock();
    expect(screen.getByRole("heading", { name: "Commission rate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Custom Tech Rate" })).not.toBeChecked();
    expect(screen.queryByRole("textbox", { name: "Custom tech rate" })).toBeNull();
  });

  it("switching on reveals the rate and its unit; Update writes them to the job", async () => {
    const u = user();
    const { onUpdate } = renderBlock();

    await u.click(screen.getByRole("switch", { name: "Custom Tech Rate" }));
    const rate = screen.getByRole("textbox", { name: "Custom tech rate" });
    fireEvent.change(rate, { target: { value: "40" } });
    await u.click(screen.getByRole("button", { name: "Update" }));

    expect(onUpdate).toHaveBeenCalledWith({ useTechSpecialRate: true, techSpecialRate: 40, techSpecialRateUnit: "%" });
  });

  it("a fixed dollar rate", async () => {
    const u = user();
    const { onUpdate } = renderBlock();

    await u.click(screen.getByRole("switch", { name: "Custom Tech Rate" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Custom tech rate" }), { target: { value: "120" } });
    await u.click(screen.getByRole("tab", { name: "$" }));
    await u.click(screen.getByRole("button", { name: "Update" }));

    expect(onUpdate).toHaveBeenCalledWith({ useTechSpecialRate: true, techSpecialRate: 120, techSpecialRateUnit: "$" });
  });

  it("opens on the job's own state and turns it off with one Update", async () => {
    const u = user();
    const { onUpdate } = renderBlock({ rate: { useTechSpecialRate: true, techSpecialRate: 35, techSpecialRateUnit: "%" } });

    expect(screen.getByRole("switch", { name: "Custom Tech Rate" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Custom tech rate" })).toHaveValue("35");
    await u.click(screen.getByRole("switch", { name: "Custom Tech Rate" }));
    await u.click(screen.getByRole("button", { name: "Update" }));

    expect(onUpdate).toHaveBeenCalledWith({ useTechSpecialRate: false });
  });

  it("Update waits for a rate while on, and for a change at all", async () => {
    const u = user();
    renderBlock({ rate: { useTechSpecialRate: true, techSpecialRate: 35, techSpecialRateUnit: "%" } });

    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Custom tech rate" }), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Custom tech rate" }), { target: { value: "120" } });
    expect(screen.getByText(/100/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
    await u.click(screen.getByRole("tab", { name: "$" }));
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
  });

  it("without commission.edit the switch and rate are read-only and there is no Update", () => {
    renderBlock({ canEdit: false, rate: { useTechSpecialRate: true, techSpecialRate: 165, techSpecialRateUnit: "$" } });
    expect(screen.getByRole("switch", { name: "Custom Tech Rate" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.getByText("$165.00")).toBeInTheDocument();
  });
});
