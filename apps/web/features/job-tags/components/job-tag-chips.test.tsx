import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { JobTag } from "@bitcrm/types";

const { catalog } = vi.hoisted(() => ({ catalog: { loading: false } }));

const rush: JobTag = {
  id: "t-rush",
  name: "Rush",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

vi.mock("../hooks", () => ({
  useJobTags: () =>
    catalog.loading ? { data: undefined, isLoading: true } : { data: [rush], isLoading: false },
}));

import { JobTagChips } from "./job-tag-chips";

describe("JobTagChips", () => {
  beforeEach(() => {
    catalog.loading = false;
  });

  it("shows skeleton pills instead of raw ids while the catalog loads", () => {
    catalog.loading = true;
    const { container } = render(<JobTagChips ids={["t-rush"]} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("t-rush")).not.toBeInTheDocument();
  });

  it("falls back to the raw id only once the catalog is loaded (purged tag)", () => {
    render(<JobTagChips ids={["t-gone"]} />);

    expect(screen.getByText("t-gone")).toBeInTheDocument();
  });
});
