import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ClientTag } from "@bitcrm/types";

const { catalog } = vi.hoisted(() => ({ catalog: { loading: false } }));

const rush: ClientTag = {
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
  useClientTags: () =>
    catalog.loading ? { data: undefined, isLoading: true } : { data: [rush], isLoading: false },
}));

import { ClientTagChips } from "./client-tag-chips";

describe("ClientTagChips", () => {
  beforeEach(() => {
    catalog.loading = false;
  });

  it("shows skeleton pills instead of raw ids while the catalog loads", () => {
    catalog.loading = true;
    const { container } = render(<ClientTagChips ids={["t-rush"]} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("t-rush")).not.toBeInTheDocument();
  });

  it("falls back to the raw id only once the catalog is loaded (purged tag)", () => {
    render(<ClientTagChips ids={["t-gone"]} />);

    expect(screen.getByText("t-gone")).toBeInTheDocument();
  });
});
