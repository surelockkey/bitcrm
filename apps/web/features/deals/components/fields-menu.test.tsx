import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
});

async function openPanel() {
  const u = userEvent.setup();
  render(<FieldsMenu />);
  await u.click(screen.getByRole("button", { name: /fields/i }));
  return u;
}

const panel = () => screen.getByRole("dialog", { name: "Visible fields" });
/** The field names in the order the panel lists them. */
const names = () =>
  within(panel())
    .getAllByRole("checkbox")
    .map((c) => c.closest("label")?.textContent?.trim());

describe("FieldsMenu — Workiz's Visible fields panel", () => {
  it("renders a Fields button", () => {
    render(<FieldsMenu />);
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
  });

  it("opens the panel offering every deal field, custom included", async () => {
    await openPanel();
    expect(within(panel()).getByText("Search fields")).toBeInTheDocument();
    expect(within(panel()).getByPlaceholderText("Type field name here")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Client" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Source" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Gate Code" })).toHaveAttribute("aria-checked", "false");
  });

  it("lists Job ID first under USED FIELDS, always on", async () => {
    await openPanel();
    expect(names().slice(0, 3)).toEqual(["Job ID", "Client", "Tech"]);
    expect(screen.getByRole("checkbox", { name: "Job ID" })).toBeDisabled();
  });

  it("groups the fields into USED and UNSELECTED", async () => {
    await openPanel();
    expect(within(panel()).getByText("Used fields")).toBeInTheDocument();
    expect(within(panel()).getByText("Unselected fields")).toBeInTheDocument();
    expect(names()).toEqual([
      "Job ID",
      "Client",
      "Tech",
      "Tags",
      "City",
      "State",
      "Scheduled",
      "Job Type",
      "Zip code",
      "Total Price",
      "Choose Company",
      "Source",
      "Address",
      "Created by",
      "End",
      "Phone",
      "Email",
      "Service area",
      "External Company",
      "Time in Status",
      "Job name",
      "Client type",
      "Dispatcher",
      "Status",
      "Priority",
      "Sent",
      "Seen",
      "PO number",
      "Payment status",
      "Notes",
      "Created",
      "Gate Code",
    ]);
  });

  it("a ticked field moves to the end of USED FIELDS, but nothing changes until Save fields", async () => {
    const u = await openPanel();
    await u.click(screen.getByRole("checkbox", { name: "Source" }));
    expect(names().slice(0, 12)).toEqual([
      "Job ID",
      "Client",
      "Tech",
      "Tags",
      "City",
      "State",
      "Scheduled",
      "Job Type",
      "Zip code",
      "Total Price",
      "Choose Company",
      "Source",
    ]);
    await u.click(screen.getByRole("checkbox", { name: "Tags" }));
    expect(screen.getByRole("checkbox", { name: "Tags" })).toHaveAttribute("aria-checked", "false");

    // The table has not seen any of it yet.
    expect(useJobFieldsStore.getState().visible.source).toBe(false);
    expect(useJobFieldsStore.getState().visible.tags).toBe(true);

    await u.click(screen.getByRole("button", { name: "Save fields" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const s = useJobFieldsStore.getState();
    expect(s.visible.source).toBe(true);
    expect(s.visible.tags).toBe(false);
    expect(s.order).toEqual(["client", "tech", "city", "state", "scheduled", "jobType", "zip", "total", "company", "source"]);
  });

  it("Cancel drops the draft", async () => {
    const u = await openPanel();
    await u.click(screen.getByRole("checkbox", { name: "Tags" }));
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useJobFieldsStore.getState().visible.tags).toBe(true);

    // Reopened, the panel starts again from what is saved.
    await u.click(screen.getByRole("button", { name: /fields/i }));
    expect(screen.getByRole("checkbox", { name: "Tags" })).toHaveAttribute("aria-checked", "true");
  });

  it("opens on the saved order", async () => {
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: ["scheduled", "client"] });
    await openPanel();
    expect(names().slice(0, 4)).toEqual(["Job ID", "Scheduled", "Client", "Tech"]);
  });

  it("each used field has a handle to drag it by", async () => {
    await openPanel();
    expect(screen.getByRole("button", { name: "Move Client" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Job ID" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Source" })).toBeNull();
  });

  it("Search fields narrows both lists", async () => {
    const u = await openPanel();
    await u.type(screen.getByPlaceholderText("Type field name here"), "gate");
    expect(names()).toEqual(["Gate Code"]);
  });

  it("reflects fields already hidden in the store", async () => {
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE, scheduled: false }, order: [] });
    await openPanel();
    expect(screen.getByRole("checkbox", { name: "Scheduled" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("checkbox", { name: "Client" })).toHaveAttribute("aria-checked", "true");
  });
});
