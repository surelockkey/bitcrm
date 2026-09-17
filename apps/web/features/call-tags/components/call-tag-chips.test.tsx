import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CallTag } from "@bitcrm/types";

const { catalog } = vi.hoisted(() => ({ catalog: { loading: false } }));

const spam: CallTag = {
  id: "ct-spam",
  name: "SPAM CALLER",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const retired: CallTag = { ...spam, id: "ct-old", name: "Lines Testing", active: false };

vi.mock("../hooks", () => ({
  useCallTags: () =>
    catalog.loading
      ? { data: undefined, isLoading: true }
      : { data: [spam, retired], isLoading: false },
}));

import { CallTagChips } from "./call-tag-chips";

describe("CallTagChips", () => {
  beforeEach(() => {
    catalog.loading = false;
  });

  it("names the call's tags", () => {
    render(<CallTagChips ids={["ct-spam"]} />);
    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
  });

  it("renders nothing for an untagged call", () => {
    const { container } = render(<CallTagChips ids={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows skeleton pills instead of raw ids while the catalog loads", () => {
    catalog.loading = true;
    const { container } = render(<CallTagChips ids={["ct-spam"]} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("ct-spam")).not.toBeInTheDocument();
  });

  it("falls back to the raw id only once the catalog is loaded", () => {
    render(<CallTagChips ids={["ct-gone"]} />);
    expect(screen.getByText("ct-gone")).toBeInTheDocument();
  });

  it("still names an archived tag — the call keeps its label", () => {
    render(<CallTagChips ids={["ct-old"]} />);
    expect(screen.getByText("Lines Testing")).toBeInTheDocument();
  });

  it("collapses the overflow into a +N chip", () => {
    render(<CallTagChips ids={["ct-spam", "ct-old", "ct-x"]} max={1} />);
    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
