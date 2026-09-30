import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { Container, ContainerTemplateDiff } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  containerLoading: false,
  container: undefined as Container | undefined,
  diff: undefined as ContainerTemplateDiff | undefined,
  diffArgs: [] as unknown[][],
}));

vi.mock("@/features/inventory/containers/hooks", () => ({
  useContainer: () => ({
    data: mocks.containerLoading ? undefined : mocks.container,
    isLoading: mocks.containerLoading,
    isError: false,
  }),
}));
vi.mock("../hooks", () => ({
  useTemplateDiff: (...args: unknown[]) => {
    mocks.diffArgs.push(args);
    return { data: mocks.diff, isLoading: false, isError: false };
  },
}));

import { ContainerTemplateBar } from "./container-template-bar";

const VAN: Container = {
  id: "c1",
  name: "Van 1",
  templateId: "tp1",
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
};

const diff = (shortLineCount: number): ContainerTemplateDiff => ({
  templateId: "tp1",
  templateName: "Standard van",
  containerId: "c1",
  containerName: "Van 1",
  lines: [],
  shortLineCount,
  missingUnits: shortLineCount * 2,
});

beforeEach(() => {
  mocks.container = VAN;
  mocks.diff = diff(2);
  mocks.diffArgs = [];
  mocks.containerLoading = false;
});

function bar() {
  const onApply = vi.fn();
  const onSetTemplate = vi.fn();
  render(<ContainerTemplateBar containerId="c1" onApply={onApply} onSetTemplate={onSetTemplate} />);
  return { onApply, onSetTemplate };
}

describe("ContainerTemplateBar", () => {
  it("names the van's template and how many lines it is missing", () => {
    bar();
    expect(screen.getByText("Template: Standard van — 2 lines missing")).toBeInTheDocument();
    // The comparison alone — no warehouse asked for here.
    expect(mocks.diffArgs.at(-1)?.slice(0, 3)).toEqual(["tp1", "c1", undefined]);
  });

  it("says when the van matches its template", () => {
    mocks.diff = diff(0);
    bar();
    expect(screen.getByText("Template: Standard van — nothing missing")).toBeInTheDocument();
  });

  it("opens Apply for this van's template", async () => {
    const { onApply } = bar();
    await userEvent.click(screen.getByRole("button", { name: "Apply template" }));
    expect(onApply).toHaveBeenCalledWith("tp1");
  });

  it("offers to set a template for a van without one", async () => {
    mocks.container = { ...VAN, templateId: undefined };
    const { onSetTemplate } = bar();
    expect(screen.queryByRole("button", { name: "Apply template" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Set a template" }));
    expect(onSetTemplate).toHaveBeenCalled();
  });

  // It used to render nothing until the van loaded, then appear and push the
  // stock table down. Its height is held from the first frame.
  it("holds its strip's height while the van loads", () => {
    mocks.containerLoading = true;
    bar();
    const strip = screen.getByTestId("template-bar");
    expect(strip.className).toMatch(/(^|\s)(min-)?h-11/);
    expect(strip).toHaveAttribute("aria-busy", "true");
  });

  it("is the same height with a template, without one, and loading", () => {
    const heights: string[] = [];
    for (const setup of [
      () => (mocks.containerLoading = true),
      () => (mocks.container = VAN),
      () => (mocks.container = { ...VAN, templateId: undefined }),
    ]) {
      mocks.containerLoading = false;
      setup();
      const { unmount } = render(<ContainerTemplateBar containerId="c1" onApply={vi.fn()} onSetTemplate={vi.fn()} />);
      heights.push(
        (screen.getByTestId("template-bar").className.match(/(^|\s)((min-)?h-\S+)/) ?? [])[2] ?? "",
      );
      unmount();
    }
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).not.toBe("");
  });
});
