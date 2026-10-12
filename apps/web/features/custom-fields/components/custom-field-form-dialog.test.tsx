import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { CustomFieldDefinition } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { CustomFieldFormDialog } from "./custom-field-form-dialog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

function mockJobTypes() {
  server.use(
    http.get("*/deals/job-types", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "jt-1", name: "Lockout", priority: 10, active: true, createdBy: "u1", createdAt: "", updatedAt: "" },
          { id: "jt-2", name: "Rekey", priority: 5, active: true, createdBy: "u1", createdAt: "", updatedAt: "" },
        ],
      }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function field(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf-1",
    name: "Notes",
    type: "text",
    group: "General",
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

beforeEach(() => {
  mockJobTypes();
});

describe("CustomFieldFormDialog", () => {
  it("hides the options editor for a non-option type", () => {
    render(
      <CustomFieldFormDialog customField={field({ type: "text" })} open onOpenChange={() => {}} />,
      { wrapper },
    );
    expect(screen.queryByText("Options")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add an option/i)).not.toBeInTheDocument();
  });

  it("shows the options editor with existing options for a dropdown", () => {
    render(
      <CustomFieldFormDialog
        customField={field({ type: "dropdown", options: ["Kwikset", "Schlage"] })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText("Options")).toBeInTheDocument();
    expect(screen.getByText("Kwikset")).toBeInTheDocument();
    expect(screen.getByText("Schlage")).toBeInTheDocument();
  });

  it("shows the options editor for a multi_select", () => {
    render(
      <CustomFieldFormDialog
        customField={field({ type: "multi_select", options: ["A"] })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText("Options")).toBeInTheDocument();
  });

  // B10: the order is set by dragging the rows, not by typing a number.
  it("has no Priority box", () => {
    render(<CustomFieldFormDialog customField={field({})} open onOpenChange={() => {}} />, { wrapper });
    expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();
  });

  // Workiz's client fields carry no job types and no required flags (the dump:
  // `job_types`, `required`, `requiredClose` all null on the six client fields).
  it("a Client field asks for name, type, group and searchable? only", () => {
    render(<CustomFieldFormDialog entityType="client" open onOpenChange={() => {}} />, { wrapper });
    expect(screen.getByLabelText("Field Name")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "searchable?" })).toBeInTheDocument();
    expect(screen.queryByText("All Job Types")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Required?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Required To Close?" })).not.toBeInTheDocument();
  });

  it("an existing client field keeps the client form", () => {
    render(
      <CustomFieldFormDialog customField={field({ entityType: "client" })} open onOpenChange={() => {}} />,
      { wrapper },
    );
    expect(screen.queryByText("All Job Types")).not.toBeInTheDocument();
  });

  it("creates a Client field on the Client tab", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post("*/deals/custom-fields", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ success: true, data: field({ entityType: "client" }) });
      }),
    );
    render(<CustomFieldFormDialog entityType="client" open onOpenChange={() => {}} />, { wrapper });

    await userEvent.type(screen.getByLabelText("Field Name"), "Vendor Number 1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: "Vendor Number 1", entityType: "client" });
    expect(body).not.toHaveProperty("priority");
  });

  it("labels the Job Types picker as All Job Types when nothing is selected", () => {
    render(
      <CustomFieldFormDialog customField={field({ jobTypeIds: [] })} open onOpenChange={() => {}} />,
      { wrapper },
    );
    expect(screen.getByText("All Job Types")).toBeInTheDocument();
  });
});
