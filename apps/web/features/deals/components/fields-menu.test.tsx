import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_VISIBLE } from "../fields";
import { useJobFieldsStore } from "../fields-store";

// The panel lists custom fields from the catalog; pin it so no QueryClient is needed.
vi.mock("@/features/custom-fields/hooks", () => ({
  useCustomFields: () => ({
    data: [
      {
        id: "cf-gate",
        name: "Gate Code",
        type: "text",
        group: "Access",
        options: [],
        jobTypeIds: [],
        required: false,
        requiredToClose: false,
        searchable: false,
        priority: 0,
        active: true,
        createdBy: "u1",
        createdAt: "",
        updatedAt: "",
      },
    ],
  }),
}));

import { FieldsMenu } from "./fields-menu";

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
});

async function openPanel() {
  const u = userEvent.setup();
  render(<FieldsMenu />);
  await u.click(screen.getByRole("button", { name: /fields/i }));
  return u;
}

describe("FieldsMenu", () => {
  it("renders a Fields button", () => {
    render(<FieldsMenu />);
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
  });

  it("opens the Visible fields panel offering every deal field, custom included", async () => {
    await openPanel();
    expect(screen.getByText("Visible fields")).toBeInTheDocument();
    // Classic column: on by default. New and custom fields: offered, off.
    expect(screen.getByRole("checkbox", { name: "Client" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Source" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Gate Code" })).toHaveAttribute("aria-checked", "false");
  });

  it("unchecking a field hides it in the store; the panel stays open", async () => {
    const u = await openPanel();
    await u.click(screen.getByRole("checkbox", { name: "Tags" }));
    expect(useJobFieldsStore.getState().visible.tags).toBe(false);
    // Still open so several fields can be toggled in one go.
    expect(screen.getByRole("checkbox", { name: "Tags" })).toHaveAttribute("aria-checked", "false");
  });

  it("reflects fields already hidden in the store", async () => {
    useJobFieldsStore.setState({
      visible: { ...DEFAULT_VISIBLE, scheduled: false },
    });
    await openPanel();
    expect(screen.getByRole("checkbox", { name: "Scheduled" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Client" })).toHaveAttribute("aria-checked", "true");
  });

  it("does not offer the job number", async () => {
    await openPanel();
    expect(screen.queryByRole("checkbox", { name: /job\s?#/i })).toBeNull();
  });
});
