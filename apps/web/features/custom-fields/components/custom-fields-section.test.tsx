import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { CustomFieldDefinition } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { CustomFieldsSection } from "./custom-fields-section";

function field(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf-1",
    name: "Field",
    type: "text",
    group: "Details",
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
    ...over,
  };
}

function mockFields(fields: CustomFieldDefinition[]) {
  server.use(
    http.get("*/deals/custom-fields", () =>
      HttpResponse.json({ success: true, data: fields }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Radix popovers set pointer-events on <body> while open; skip the check in jsdom.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

const DEFS: CustomFieldDefinition[] = [
  field({ id: "cf-text", name: "Notes", type: "text", group: "Details" }),
  field({
    id: "cf-drop",
    name: "Brand",
    type: "dropdown",
    group: "Details",
    options: ["Kwikset", "Schlage"],
    jobTypeIds: ["jt-1"],
  }),
  field({ id: "cf-check", name: "Urgent", type: "checkbox", group: "Flags", required: true }),
  field({
    id: "cf-multi",
    name: "Tags",
    type: "multi_select",
    group: "Flags",
    options: ["A", "B"],
  }),
  // Scoped to a different job type — must NOT render for jt-1.
  field({ id: "cf-other", name: "OtherOnly", type: "text", group: "Details", jobTypeIds: ["jt-2"] }),
];

beforeEach(() => {
  mockFields(DEFS);
});

describe("CustomFieldsSection", () => {
  it("renders only the fields applicable to the given jobTypeId", async () => {
    render(
      <CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={vi.fn()} dealId="d1" />,
      { wrapper },
    );

    expect(await screen.findByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    // Scoped to jt-2 only.
    expect(screen.queryByText("OtherOnly")).not.toBeInTheDocument();
  });

  it("groups fields under their group heading", async () => {
    render(
      <CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={vi.fn()} dealId="d1" />,
      { wrapper },
    );

    const details = await screen.findByRole("heading", { name: "Details" });
    const flags = screen.getByRole("heading", { name: "Flags" });
    expect(details).toBeInTheDocument();
    expect(flags).toBeInTheDocument();
  });

  it("marks required fields visually", async () => {
    render(
      <CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={vi.fn()} dealId="d1" />,
      { wrapper },
    );
    // Urgent is required → its label carries a required marker.
    const marker = await screen.findByLabelText("required");
    expect(marker).toBeInTheDocument();
  });

  it("calls onChange with the picked value when a dropdown changes", async () => {
    const onChange = vi.fn();
    const u = user();
    render(
      <CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={onChange} dealId="d1" />,
      { wrapper },
    );

    await screen.findByText("Brand");
    await u.click(screen.getByRole("combobox"));
    await u.click(await screen.findByRole("option", { name: "Schlage" }));

    expect(onChange).toHaveBeenLastCalledWith({ "cf-drop": "Schlage" });
  });

  it("calls onChange with true when a checkbox is toggled on", async () => {
    const onChange = vi.fn();
    const u = user();
    render(
      <CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={onChange} dealId="d1" />,
      { wrapper },
    );

    await u.click(await screen.findByRole("checkbox", { name: "Urgent" }));
    expect(onChange).toHaveBeenLastCalledWith({ "cf-check": true });
  });

  it("calls onChange with the selected options array for a multi_select", async () => {
    const onChange = vi.fn();
    const u = user();
    render(
      <CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={onChange} dealId="d1" />,
      { wrapper },
    );

    await u.click(await screen.findByRole("button", { name: /add tags/i }));
    await u.click(await screen.findByRole("option", { name: "A" }));

    expect(onChange).toHaveBeenLastCalledWith({ "cf-multi": ["A"] });
  });

  it("prompts to save the job first for a file field when no dealId is set", async () => {
    mockFields([field({ id: "cf-file", name: "Photo", type: "file", group: "Details" })]);
    render(<CustomFieldsSection jobTypeId="jt-1" value={{}} onChange={vi.fn()} />, { wrapper });

    expect(await screen.findByText(/save the job first/i)).toBeInTheDocument();
  });
});
