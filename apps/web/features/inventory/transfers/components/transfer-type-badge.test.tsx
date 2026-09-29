import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransferType } from "@bitcrm/types";
import { TransferTypeBadge } from "./transfer-type-badge";

describe("TransferTypeBadge", () => {
  it("labels a return and does not mark it automatic", () => {
    render(<TransferTypeBadge type={TransferType.RETURN} />);
    const badge = screen.getByText("Return");
    // Every type has its own tone; without one the chip has no fill at all.
    expect(badge.className).toMatch(/(^|\s)bg-/);
    expect(screen.queryByText("auto")).toBeNull();
  });
});
