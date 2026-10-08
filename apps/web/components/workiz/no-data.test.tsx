import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WzTableNoData } from "./no-data";

describe("WzTableNoData — react-table's 'No Records Found'", () => {
  it("says it in Workiz's words by default, 15px/500 on a white wash", () => {
    render(<WzTableNoData />);
    const note = screen.getByText("No Records Found");
    expect(note.className).toContain("text-[15px]");
    expect(note.className).toContain("font-medium");
    expect(note.closest("[data-slot='wz-table-no-data']")?.className).toContain("bg-white/70");
  });

  it("takes other words", () => {
    render(<WzTableNoData>Nothing here</WzTableNoData>);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
